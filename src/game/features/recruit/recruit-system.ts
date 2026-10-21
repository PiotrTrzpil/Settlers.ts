/**
 * RecruitSystem — carrier-to-specialist recruitment dispatch + the player-queued recruit queue.
 *
 * Dispatch picks (carrier, source) and hands the caller a {@link RecruitSegment}; with
 * `opts.buildSpec` the caller returns the JobSpec of its own JobKind (whose `build` prefixes its
 * continuation with `segments.prefix(segment, …)`), and RecruitSystem reserves the source and
 * assigns it via `jobs.assign`. The player queue (drained here, camera-center hint supported)
 * dispatches stand-alone `Recruit` jobs.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import { EventSubscriptionManager } from '../../event-bus';
import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { ToolSourceResolver, MaterialCost, InventorySide } from './tool-source-resolver';
import type { IdleCarrierPool } from '../carriers';
import type { JobService } from '../settler-tasks';
import type { Race } from '../../core/race';
import type { JobSpec } from '../../systems/choreo';
import { recruitJobSpec } from './recruit-job-kind';
import type { RecruitSegment, RecruitSegments } from './recruit-segments';
import {
    RecruitCandidateFinder,
    toolMaterialOf,
    type CandidateSearchOpts,
    type RecruitmentCandidate,
} from './recruit-candidates';
import { createLogger } from '@/utilities/logger';
import type { Tile } from '@/game/core/coordinates';

export type { TileWithPile } from './recruit-candidates';

const log = createLogger('RecruitSystem');

const QUEUE_DRAIN_INTERVAL = 0.5; // seconds

// ─── Public types ─────────────────────────────────────────────────────

/** Builds the JobSpec that runs `segment` (and the caller's continuation) on the chosen carrier. */
export type RecruitSpecBuilder = (carrierId: number, segment: RecruitSegment) => JobSpec;

/** Options for dispatchRecruitment / dispatchRecruitmentFromPile. */
export interface DispatchRecruitmentOpts extends CandidateSearchOpts {
    /**
     * The JobSpec of the caller's kind for the chosen carrier + segment. The caller's `build` must
     * start with `segments.prefix(segment, …)` (or `segments.nodes(segment)`) and set `reserved: true`.
     */
    buildSpec: RecruitSpecBuilder;
}

// ─── Queue entry ──────────────────────────────────────────────────────

interface QueueEntry {
    toolMaterial: EMaterialType | null;
    player: number;
    race: Race;
    count: number;
    /** Camera-center hint supplied at enqueue time. null = no preference. */
    near: Tile | null;
}

// ─── Config ───────────────────────────────────────────────────────────

export interface RecruitSystemConfig {
    gameState: GameState;
    idleCarrierPool: IdleCarrierPool;
    toolSourceResolver: ToolSourceResolver;
    segments: RecruitSegments;
    jobs: JobService;
    /** Rejects carriers in territory pockets disconnected from the reference tile. */
    territoryCheck: (a: Tile, b: Tile, player: number) => boolean;
}

// ─── System ───────────────────────────────────────────────────────────

export class RecruitSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly segments: RecruitSegments;
    private readonly jobs: JobService;
    private readonly candidates: RecruitCandidateFinder;
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly queue = new Map<UnitType, QueueEntry>();
    private queueTimer = 0;

    constructor(config: RecruitSystemConfig) {
        this.gameState = config.gameState;
        this.idleCarrierPool = config.idleCarrierPool;
        this.toolSourceResolver = config.toolSourceResolver;
        this.segments = config.segments;
        this.jobs = config.jobs;
        this.candidates = new RecruitCandidateFinder(config);
    }

    // =====================================================================
    // Public API — unified recruitment dispatch
    // =====================================================================

    /**
     * Find the best carrier to recruit as the given specialist type (tool pile included when the
     * type needs one). opts.target optimizes carrier→tool→target; opts.hint picks the tool nearest
     * the hint; neither minimizes carrier→tool.
     */
    findRecruitmentCandidate(
        unitType: UnitType,
        player: number,
        opts?: CandidateSearchOpts
    ): RecruitmentCandidate | null {
        return this.candidates.find(unitType, player, opts);
    }

    /**
     * Full recruitment dispatch — find a candidate, reserve its source, assign the caller's job.
     * Returns the carrier id on success, null otherwise (nothing stays reserved).
     */
    dispatchRecruitment(unitType: UnitType, player: number, opts: DispatchRecruitmentOpts): number | null {
        const candidate = this.candidates.find(unitType, player, opts);
        if (!candidate) {
            return null;
        }
        return this.assignSpec(candidate.carrierId, segmentOf(candidate, unitType), opts.buildSpec);
    }

    /**
     * Dispatch recruitment using a specific pile as the tool source (e.g. a weapon on a barracks
     * output slot). Returns the carrier id on success, null otherwise.
     */
    dispatchRecruitmentFromPile(
        unitType: UnitType,
        player: number,
        pileEntityId: number,
        opts: DispatchRecruitmentOpts
    ): number | null {
        const toolMaterial = toolMaterialOf(unitType);
        if (toolMaterial === null) {
            throw new Error(`dispatchRecruitmentFromPile: ${unitType} requires no tool — use dispatchRecruitment`);
        }
        const toolPile = this.toolSourceResolver.validatePile(pileEntityId, toolMaterial, player);
        if (!toolPile) {
            return null;
        }
        const carrierId = this.candidates.nearestCarrier(toolPile, player);
        if (carrierId === null) {
            return null;
        }
        return this.assignSpec(carrierId, segmentOf({ carrierId, toolPile }, unitType), opts.buildSpec);
    }

    /**
     * Owned-job dispatch consuming materials from a building's inventory (barracks training). The
     * costs and side come from the charge the building's type registered
     * (`segments.registerBuildingCharge`), so the TRANSFORM_RECRUIT_BUILDING hooks can re-resolve
     * them after a load. The carrier walks to the first slot holding a cost material.
     */
    dispatchBuildingRecruitment(
        unitType: UnitType,
        player: number,
        buildingId: number,
        buildSpec: RecruitSpecBuilder
    ): number | null {
        const { costs, side } = this.segments.chargeFor(buildingId, unitType);
        const found = this.findBuildingCarrier(player, buildingId, costs, side);
        if (!found) {
            return null;
        }
        const segment: RecruitSegment = {
            targetUnitType: unitType,
            source: 'building',
            sourceId: buildingId,
            at: found.at,
        };
        return this.assignSpec(found.carrierId, segment, buildSpec);
    }

    // =====================================================================
    // Public API — player-queued recruitment
    // =====================================================================

    enqueue(
        unitType: UnitType,
        count: number,
        toolMaterial: EMaterialType | null,
        player: number,
        race: Race,
        near: Tile | null = null
    ): void {
        const existing = this.queue.get(unitType);
        if (existing) {
            existing.count += count;
            if (near) {
                existing.near = near;
            }
        } else {
            this.queue.set(unitType, { toolMaterial, player, race, count, near });
        }
        log.debug(`Enqueued ${count}× ${unitType}` + ` (total: ${this.queue.get(unitType)!.count})`);
    }

    dequeue(unitType: UnitType, count: number): void {
        const existing = this.queue.get(unitType);
        if (!existing) {
            return;
        }
        existing.count = Math.max(0, existing.count - count);
        if (existing.count === 0) {
            this.queue.delete(unitType);
        }
        log.debug(`Dequeued ${count}× ${unitType}`);
    }

    getQueuedCount(unitType: UnitType): number {
        // eslint-disable-next-line no-restricted-syntax -- unit type may have no queue entry; 0 is the correct default (no units queued)
        return this.queue.get(unitType)?.count ?? 0;
    }

    // =====================================================================
    // Event registration
    // =====================================================================

    registerEvents(): void {
        // No event subscriptions needed — player-queued recruitment is tick-driven.
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    // =====================================================================
    // TickSystem
    // =====================================================================

    tick(dt: number): void {
        this.queueTimer += dt;
        if (this.queueTimer >= QUEUE_DRAIN_INTERVAL) {
            this.queueTimer -= QUEUE_DRAIN_INTERVAL;
            // Refresh spatial idle-carrier index once for all lookups this drain.
            this.idleCarrierPool.beginFrame();
            this.drainQueue();
        }
    }

    // =====================================================================
    // Queue drain (player-initiated) — stand-alone Recruit jobs
    // =====================================================================

    private drainQueue(): void {
        const justDispatched: number[] = [];

        for (const [unitType, entry] of this.queue) {
            const carrierId = this.dispatchRecruitment(unitType, entry.player, {
                ...(entry.near ? { hint: entry.near } : {}),
                buildSpec: (_carrierId, segment) => recruitJobSpec(segment),
            });

            if (carrierId !== null) {
                entry.count--;
                if (entry.count === 0) {
                    this.queue.delete(unitType);
                }
                justDispatched.push(carrierId);
            }
        }

        if (justDispatched.length > 0) {
            const current = [...this.gameState.selection.selectedEntityIds];
            this.gameState.selection.selectMultiple([...current, ...justDispatched]);
        }
    }

    // =====================================================================
    // Internal — recruitment execution
    // =====================================================================

    /** Reserve the segment's source, assign the caller's spec; undo the reservation on failure. */
    private assignSpec(carrierId: number, segment: RecruitSegment, buildSpec: RecruitSpecBuilder): number | null {
        if (!this.segments.reserve(carrierId, segment)) {
            return null;
        }
        const spec = buildSpec(carrierId, segment);
        const assigned = segment.at
            ? this.jobs.assign(carrierId, spec, { moveTo: segment.at })
            : this.jobs.assign(carrierId, spec);
        if (!assigned) {
            this.segments.release(carrierId);
            return null;
        }
        log.debug(`Carrier ${carrierId} dispatched (${spec.kind}) to transform into ${segment.targetUnitType}`);
        return carrierId;
    }

    /** Nearest idle carrier for a building recruit + its walk goal; null if stock or carriers lack. */
    private findBuildingCarrier(
        player: number,
        buildingId: number,
        costs: readonly MaterialCost[],
        side: InventorySide
    ): { carrierId: number; at: Tile } | null {
        if (!this.toolSourceResolver.hasBuildingMaterials(buildingId, costs, side)) {
            return null;
        }
        const at = this.toolSourceResolver.findBuildingSlotPosition(buildingId, costs, side);
        if (!at) {
            return null;
        }
        const carrierId = this.candidates.nearestCarrier(at, player);
        return carrierId === null ? null : { carrierId, at };
    }
}

/** The segment of a found candidate: its tool pile, or a direct transform. */
function segmentOf(candidate: RecruitmentCandidate, unitType: UnitType): RecruitSegment {
    const pile = candidate.toolPile;
    if (!pile) {
        return { targetUnitType: unitType, source: 'direct', sourceId: null, at: null };
    }
    return { targetUnitType: unitType, source: 'pile', sourceId: pile.pileEntityId, at: { x: pile.x, y: pile.y } };
}

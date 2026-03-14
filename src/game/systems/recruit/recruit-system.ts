/**
 * RecruitSystem — player-queued carrier-to-specialist transformation.
 *
 * Drains a per-type queue populated via enqueue() (from the
 * recruit_specialist command). Supports a camera-center hint so the
 * nearest carrier / tool pile to the current view is chosen first;
 * without a hint the carrier closest to any available tool pile wins.
 *
 * Construction worker recruitment is handled by ConstructionSiteDemandSystem.
 * Building-worker demands (specialist → workplace) are handled by
 * BuildingDemandSystem.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import { EventSubscriptionManager, type EventBus } from '../../event-bus';
import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { UnitTransformer } from './unit-transformer';
import type { ToolSourceResolver } from './tool-source-resolver';
import type { IdleCarrierPool } from '../idle-carrier-pool';
import type { Race } from '../../core/race';
import type { ChoreoJobState } from '../choreo';
import { SPECIALIST_TOOL_MAP } from './specialist-tool-map';
import { createRecruitmentJob } from './recruitment-job';
import { createLogger } from '@/utilities/logger';
import { query } from '../../ecs';

const log = createLogger('RecruitSystem');

const QUEUE_DRAIN_INTERVAL = 0.5; // seconds

// ─── Public types ─────────────────────────────────────────────────────

/** Result of findRecruitmentCandidate — carrier + optional tool pile. */
export interface RecruitmentCandidate {
    carrierId: number;
    toolPile: { pileEntityId: number; x: number; y: number } | null;
}

/** Options for dispatchRecruitment. */
export interface DispatchRecruitmentOpts {
    /** Destination after recruitment (optimizes carrier→tool→target distance). */
    target?: { x: number; y: number };
    /** Camera-center hint (for player-queued recruitment from UI). */
    hint?: { x: number; y: number };
    /**
     * Additional choreo steps appended after the recruitment prefix.
     * Receives the ChoreoBuilder with walk-to-tool + transform already added,
     * and should return the extended ChoreoJobState.
     */
    buildJob?: (candidate: RecruitmentCandidate) => ChoreoJobState;
}

// ─── Queue entry ──────────────────────────────────────────────────────

interface QueueEntry {
    toolMaterial: EMaterialType | null;
    player: number;
    race: Race;
    count: number;
    /** Camera-center hint supplied at enqueue time. null = no preference. */
    near: { x: number; y: number } | null;
}

// ─── Config ───────────────────────────────────────────────────────────

export interface RecruitSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
    idleCarrierPool: IdleCarrierPool;
    unitTransformer: UnitTransformer;
    toolSourceResolver: ToolSourceResolver;
    assignJob: (unitId: number, job: ChoreoJobState, moveTo?: { x: number; y: number }) => boolean;
}

// ─── System ───────────────────────────────────────────────────────────

export class RecruitSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly unitTransformer: UnitTransformer;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly assignJob: RecruitSystemConfig['assignJob'];
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly queue = new Map<UnitType, QueueEntry>();
    private queueTimer = 0;

    constructor(config: RecruitSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.idleCarrierPool = config.idleCarrierPool;
        this.unitTransformer = config.unitTransformer;
        this.toolSourceResolver = config.toolSourceResolver;
        this.assignJob = config.assignJob;
    }

    // =====================================================================
    // Public API — unified recruitment dispatch
    // =====================================================================

    /**
     * Find the best carrier to recruit as the given specialist type.
     *
     * Derives tool material from SPECIALIST_TOOL_MAP internally — callers
     * never need to know about tool piles or tool sources.
     *
     * opts.target — destination after recruitment (building, construction site).
     *   Optimizes total carrier→tool + tool→target distance.
     * opts.hint — camera-center or reference point for "nearest" when no target
     *   is known (e.g. player-queued recruitment from UI).
     *
     * When neither target nor hint is given, finds the carrier+tool pair with
     * the shortest carrier→tool distance.
     */
    findRecruitmentCandidate(
        unitType: UnitType,
        player: number,
        opts?: {
            target?: { x: number; y: number };
            hint?: { x: number; y: number };
        }
    ): RecruitmentCandidate | null {
        const toolMaterial = SPECIALIST_TOOL_MAP[unitType] ?? null;

        if (toolMaterial !== null) {
            return this.findToolBasedCandidate(toolMaterial, player, opts);
        }

        // No tool needed — find nearest idle carrier
        const ref = opts?.target ?? opts?.hint;
        if (ref) {
            const carrierId = this.idleCarrierPool.findNearest(ref.x, ref.y, player);
            return carrierId !== null ? { carrierId, toolPile: null } : null;
        }

        // No reference point — find any idle carrier
        const carrierId = this.idleCarrierPool.findNearest(0, 0, player);
        return carrierId !== null ? { carrierId, toolPile: null } : null;
    }

    /**
     * Full recruitment dispatch — find candidate, build choreo, assign job,
     * register transform. Returns carrierId on success, null on failure.
     *
     * Callers provide opts.buildJob to customize the choreo (e.g. append
     * walk-to-site → DIG_TILE after the recruitment prefix). If omitted,
     * the default AUTO_RECRUIT job is used.
     *
     * This is the primary API for demand systems — they never need to touch
     * UnitTransformer, tool piles, or choreo building directly.
     */
    dispatchRecruitment(unitType: UnitType, player: number, opts?: DispatchRecruitmentOpts): number | null {
        const candidate = this.findRecruitmentCandidate(unitType, player, opts);
        if (!candidate) {
            return null;
        }

        const toolMaterial = SPECIALIST_TOOL_MAP[unitType] ?? null;

        if (toolMaterial !== null) {
            return this.executeToolRecruitment(candidate, unitType, toolMaterial, opts);
        }

        return this.executeDirectRecruitment(candidate.carrierId, unitType, player);
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
        near: { x: number; y: number } | null = null
    ): void {
        const existing = this.queue.get(unitType);
        if (existing) {
            existing.count += count;
            if (near) {
                existing.near = near;
            }
        } else {
            this.queue.set(unitType, {
                toolMaterial,
                player,
                race,
                count,
                near,
            });
        }
        const enqueued = this.queue.get(unitType);
        if (!enqueued) {
            throw new Error(`No queue entry for ${unitType} in RecruitSystem.enqueue`);
        }
        log.debug(`Enqueued ${count}× ${unitType}` + ` (total: ${enqueued.count})`);
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
            this.drainQueue();
        }
    }

    // =====================================================================
    // Queue drain (player-initiated)
    // =====================================================================

    private drainQueue(): void {
        const justDispatched: number[] = [];

        for (const [unitType, entry] of this.queue) {
            const carrierId = this.dispatchRecruitment(
                unitType,
                entry.player,
                entry.near ? { hint: entry.near } : undefined
            );

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

    private executeToolRecruitment(
        candidate: RecruitmentCandidate,
        unitType: UnitType,
        toolMaterial: EMaterialType,
        opts?: DispatchRecruitmentOpts
    ): number | null {
        const toolPile = candidate.toolPile!;

        // Build choreo: either caller-provided or default AUTO_RECRUIT
        const job = opts?.buildJob
            ? opts.buildJob(candidate)
            : createRecruitmentJob(toolPile.pileEntityId, toolPile.x, toolPile.y, unitType);

        const assigned = this.unitTransformer.assignAndRegisterTransform(
            candidate.carrierId,
            job,
            unitType,
            toolMaterial,
            toolPile
        );
        return assigned ? candidate.carrierId : null;
    }

    private executeDirectRecruitment(carrierId: number, unitType: UnitType, player: number): number | null {
        const ok = this.unitTransformer.requestDirectTransform(carrierId, unitType, player);
        return ok ? carrierId : null;
    }

    // =====================================================================
    // Internal — tool-based candidate search
    // =====================================================================

    /**
     * Find the best (carrier, toolPile) pair for a tool-based recruitment.
     *
     * With hint: find tool nearest to hint, then carrier nearest to that tool.
     * With target (no hint): iterate all idle carriers, find tool nearest to each,
     *   minimize carrier→tool + tool→target.
     * Neither: iterate all idle carriers, find tool nearest to each,
     *   minimize carrier→tool distance only.
     */
    private findToolBasedCandidate(
        toolMaterial: EMaterialType,
        player: number,
        opts?: { target?: { x: number; y: number }; hint?: { x: number; y: number } }
    ): RecruitmentCandidate | null {
        // Hint mode: find tool nearest to hint, then carrier nearest to tool
        if (opts?.hint) {
            return this.resolveToolWithHint(toolMaterial, opts.hint, player);
        }

        // Iterate carriers, find best (carrier, tool) pair
        return this.resolveToolByScan(toolMaterial, player, opts?.target);
    }

    private resolveToolWithHint(
        toolMaterial: EMaterialType,
        hint: { x: number; y: number },
        player: number
    ): RecruitmentCandidate | null {
        const toolPile = this.toolSourceResolver.findNearestToolPile(toolMaterial, hint.x, hint.y, player);
        if (!toolPile) {
            return null;
        }
        const carrierId = this.idleCarrierPool.findNearest(toolPile.x, toolPile.y, player);
        if (carrierId === null) {
            return null;
        }
        return { carrierId, toolPile };
    }

    /**
     * Scan all idle carriers. For each, find the nearest tool pile and compute
     * total trip cost: carrier→tool + (tool→target if target given).
     */
    private resolveToolByScan(
        toolMaterial: EMaterialType,
        player: number,
        target?: { x: number; y: number }
    ): RecruitmentCandidate | null {
        let best: RecruitmentCandidate | null = null;
        let bestCost = Infinity;

        const store = this.idleCarrierPool.carrierStore;

        for (const [id, , entity] of query(store, this.gameState.store)) {
            if (entity.player !== player) {
                continue;
            }
            if (!this.idleCarrierPool.isIdle(id)) {
                continue;
            }

            const toolPile = this.toolSourceResolver.findNearestToolPile(toolMaterial, entity.x, entity.y, player);
            if (!toolPile) {
                continue;
            }

            const cost = tripCost(entity.x, entity.y, toolPile.x, toolPile.y, target);
            if (cost < bestCost) {
                bestCost = cost;
                best = { carrierId: id, toolPile };
            }
        }

        return best;
    }
}

/** Squared distance for carrier→tool leg, plus optional tool→target leg. */
function tripCost(
    carrierX: number,
    carrierY: number,
    toolX: number,
    toolY: number,
    target?: { x: number; y: number }
): number {
    const cdx = carrierX - toolX;
    const cdy = carrierY - toolY;
    let cost = cdx * cdx + cdy * cdy;
    if (target) {
        const tdx = toolX - target.x;
        const tdy = toolY - target.y;
        cost += tdx * tdx + tdy * tdy;
    }
    return cost;
}

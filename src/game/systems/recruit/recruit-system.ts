/**
 * RecruitSystem — unified system for carrier-to-specialist transformation.
 *
 * Handles two recruitment flows in a single tick:
 *
 * 1. Background auto-recruitment (every 1 s):
 *    Watches construction sites and dispatches carriers as Builders / Diggers
 *    up to a per-type cap, nearest to each site.
 *
 * 2. Player-queued recruitment (every 0.5 s):
 *    Drains a per-type queue populated via enqueue() (from the recruit_specialist command).
 *    Supports a camera-center hint so the nearest carrier / tool pile to the current
 *    view is chosen first; without a hint the carrier closest to any available tool pile wins.
 *
 * Both flows delegate the actual transformation to UnitTransformer.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import { EventSubscriptionManager, type EventBus } from '../../event-bus';
import { EntityType } from '../../entity';
import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { CarrierRegistry } from '../carrier-registry';
import type { UnitTransformer } from './unit-transformer';
import type { UnitReservationRegistry } from '../unit-reservation';
import type { ToolSourceResolver } from './tool-source-resolver';
import type { Race } from '../../core/race';
import { query } from '@/game/ecs';
import { createLogger } from '@/utilities/logger';

const log = createLogger('RecruitSystem');

const QUEUE_DRAIN_INTERVAL = 0.5; // seconds
const AUTO_CHECK_INTERVAL = 1.0; // seconds

const MAX_AUTO_BUILDERS = 4;
const MAX_AUTO_DIGGERS = 4;

// ─── Queue entry ─────────────────────────────────────────────────────────────

interface QueueEntry {
    toolMaterial: EMaterialType | null;
    player: number;
    race: Race;
    count: number;
    /** Camera-center hint supplied at enqueue time. null = no preference. */
    near: { x: number; y: number } | null;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RecruitSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
    carrierRegistry: CarrierRegistry;
    unitTransformer: UnitTransformer;
    unitReservation: UnitReservationRegistry;
    toolSourceResolver: ToolSourceResolver;
    isCarrierBusy: (carrierId: number) => boolean;
}

interface WorkerDemand {
    role: 'digger' | 'builder';
    tileX: number;
    tileY: number;
    player: number;
}

// ─── System ──────────────────────────────────────────────────────────────────

export class RecruitSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly unitTransformer: UnitTransformer;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly isCarrierBusy: (carrierId: number) => boolean;
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly queue = new Map<UnitType, QueueEntry>();
    private pendingDemand: WorkerDemand[] = [];
    private queueTimer = 0;
    private autoTimer = 0;

    constructor(config: RecruitSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierRegistry = config.carrierRegistry;
        this.unitTransformer = config.unitTransformer;
        this.unitReservation = config.unitReservation;
        this.toolSourceResolver = config.toolSourceResolver;
        this.isCarrierBusy = config.isCarrierBusy;
    }

    // =========================================================================
    // Public API — player-queued recruitment
    // =========================================================================

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
            if (near) existing.near = near;
        } else {
            this.queue.set(unitType, { toolMaterial, player, race, count, near });
        }
        log.debug(`Enqueued ${count}× ${UnitType[unitType]} (total: ${this.queue.get(unitType)!.count})`);
    }

    dequeue(unitType: UnitType, count: number): void {
        const existing = this.queue.get(unitType);
        if (!existing) return;
        existing.count = Math.max(0, existing.count - count);
        if (existing.count === 0) this.queue.delete(unitType);
        log.debug(`Dequeued ${count}× ${UnitType[unitType]}`);
    }

    getQueuedCount(unitType: UnitType): number {
        return this.queue.get(unitType)?.count ?? 0;
    }

    // =========================================================================
    // Event registration
    // =========================================================================

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'construction:workerNeeded', ({ role, tileX, tileY, player }) => {
            this.pendingDemand.push({ role, tileX, tileY, player });
        });
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    // =========================================================================
    // TickSystem
    // =========================================================================

    tick(dt: number): void {
        this.queueTimer += dt;
        if (this.queueTimer >= QUEUE_DRAIN_INTERVAL) {
            this.queueTimer -= QUEUE_DRAIN_INTERVAL;
            this.drainQueue();
        }

        this.autoTimer += dt;
        if (this.autoTimer >= AUTO_CHECK_INTERVAL) {
            this.autoTimer -= AUTO_CHECK_INTERVAL;
            this.drainDemand();
        }
    }

    // =========================================================================
    // Queue drain (player-initiated)
    // =========================================================================

    private drainQueue(): void {
        const justDispatched: number[] = [];

        for (const [unitType, entry] of this.queue) {
            const target = this.resolveDispatch(entry);
            if (!target) continue;

            const ok =
                entry.toolMaterial !== null
                    ? this.unitTransformer.requestTransform(
                        target.carrierId,
                        unitType,
                        entry.toolMaterial,
                        target.nearX,
                        target.nearY,
                        entry.player
                    )
                    : this.unitTransformer.requestDirectTransform(target.carrierId, unitType, entry.player);

            if (ok) {
                entry.count--;
                if (entry.count === 0) this.queue.delete(unitType);
                justDispatched.push(target.carrierId);
            }
        }

        if (justDispatched.length > 0) {
            // Add dispatched carriers to the selection so the player can track recruitment.
            // Selection persists through transform (same entity ID), so the specialist
            // will remain selected once the transform completes.
            const current = [...this.gameState.selection.selectedEntityIds];
            this.gameState.selection.selectMultiple([...current, ...justDispatched]);
        }
    }

    /**
     * Resolve the best (carrierId, search-center) for a queue entry.
     *
     * With camera hint:
     *   tool-based → tool nearest hint → carrier nearest that tool
     *   no-tool    → carrier nearest hint
     * Without hint:
     *   tool-based → carrier closest to its own nearest tool pile
     *   no-tool    → first idle carrier
     */
    private resolveDispatch(entry: QueueEntry): { carrierId: number; nearX: number; nearY: number } | null {
        if (entry.toolMaterial !== null) {
            return entry.near
                ? this.dispatchToolWithHint(entry.toolMaterial, entry.near, entry.player)
                : this.dispatchToolAuto(entry.toolMaterial, entry.player);
        }
        if (entry.near) {
            const id = this.findCarrierNearest(entry.near.x, entry.near.y, entry.player);
            return id !== null ? { carrierId: id, nearX: entry.near.x, nearY: entry.near.y } : null;
        }
        const id = this.findAnyIdleCarrier(entry.player);
        return id !== null ? { carrierId: id, nearX: 0, nearY: 0 } : null;
    }

    private dispatchToolWithHint(
        toolMaterial: EMaterialType,
        hint: { x: number; y: number },
        player: number
    ): { carrierId: number; nearX: number; nearY: number } | null {
        const tool = this.toolSourceResolver.findNearestToolPile(toolMaterial, hint.x, hint.y, player);
        if (!tool) return null;
        const carrierId = this.findCarrierNearest(tool.x, tool.y, player);
        return carrierId !== null ? { carrierId, nearX: tool.x, nearY: tool.y } : null;
    }

    private dispatchToolAuto(
        toolMaterial: EMaterialType,
        player: number
    ): { carrierId: number; nearX: number; nearY: number } | null {
        let bestId: number | null = null;
        let bestNearX = 0;
        let bestNearY = 0;
        let bestDistSq = Infinity;

        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (!this.isIdleCarrier(id, entity.player, player)) continue;
            const tool = this.toolSourceResolver.findNearestToolPile(toolMaterial, entity.x, entity.y, player);
            if (!tool) continue;
            const distSq = (entity.x - tool.x) ** 2 + (entity.y - tool.y) ** 2;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestId = id;
                bestNearX = entity.x;
                bestNearY = entity.y;
            }
        }

        return bestId !== null ? { carrierId: bestId, nearX: bestNearX, nearY: bestNearY } : null;
    }

    // =========================================================================
    // Auto-recruitment (event-driven demand queue)
    // =========================================================================

    private drainDemand(): void {
        const remaining: WorkerDemand[] = [];
        for (const demand of this.pendingDemand) {
            try {
                if (!this.tryFulfillDemand(demand)) remaining.push(demand);
            } catch (e) {
                log.error(`Auto-recruit failed for demand`, e instanceof Error ? e : new Error(String(e)));
            }
        }
        this.pendingDemand = remaining;
    }

    /**
     * Try to fulfill one worker demand. Returns true if the demand is satisfied
     * (either dispatched or discarded because we're at cap). Returns false if
     * no idle carrier was available — caller should retry next tick.
     */
    private tryFulfillDemand(demand: WorkerDemand): boolean {
        const unitType = demand.role === 'digger' ? UnitType.Digger : UnitType.Builder;
        const toolMaterial = demand.role === 'digger' ? EMaterialType.SHOVEL : EMaterialType.HAMMER;
        const cap = demand.role === 'digger' ? MAX_AUTO_DIGGERS : MAX_AUTO_BUILDERS;

        const live = this.countLive(demand.player, unitType);
        const pending = this.unitTransformer.getPendingCountByType(unitType);
        if (live + pending >= cap) return true; // at cap — discard demand

        const carrierId = this.findCarrierNearest(demand.tileX, demand.tileY, demand.player);
        if (carrierId === null) return false; // retry when a carrier becomes available

        return this.unitTransformer.requestTransform(
            carrierId,
            unitType,
            toolMaterial,
            demand.tileX,
            demand.tileY,
            demand.player
        );
    }

    // =========================================================================
    // Shared carrier helpers
    // =========================================================================

    private findCarrierNearest(refX: number, refY: number, player: number): number | null {
        let bestId: number | null = null;
        let bestDistSq = Infinity;
        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (!this.isIdleCarrier(id, entity.player, player)) continue;
            const distSq = (entity.x - refX) ** 2 + (entity.y - refY) ** 2;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestId = id;
            }
        }
        return bestId;
    }

    private findAnyIdleCarrier(player: number): number | null {
        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (this.isIdleCarrier(id, entity.player, player)) return id;
        }
        return null;
    }

    private isIdleCarrier(id: number, entityPlayer: number, player: number): boolean {
        return entityPlayer === player && !this.isCarrierBusy(id) && !this.unitReservation.isReserved(id);
    }

    // =========================================================================
    // Misc helpers
    // =========================================================================

    private countLive(player: number, unitType: UnitType): number {
        let count = 0;
        for (const e of this.gameState.entities) {
            if (e.type === EntityType.Unit && e.subType === unitType && e.player === player) count++;
        }
        return count;
    }
}

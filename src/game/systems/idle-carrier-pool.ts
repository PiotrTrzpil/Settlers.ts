/**
 * IdleCarrierPool — centralized "find nearest available carrier" query service.
 *
 * Replaces 4 duplicated findIdleCarrier implementations across logistics,
 * construction-demand, building-demand, and barracks features.
 *
 * "Available" means: not busy with any job (entity.jobId == null), not reserved
 * by another feature (barracks training, auto-recruit, garrison), and passes an
 * optional caller-specific eligibility filter.
 *
 * This is a stateless query service — it does not claim or reserve carriers.
 * Callers still do their own claiming after finding a carrier.
 */

import type { GameState } from '../game-state';
import type { CarrierRegistry } from './carrier-registry';
import type { UnitReservationRegistry } from './unit-reservation';
import { query } from '../ecs';
import { distSq } from '../core/distance';

/** Optional caller-specific filter (e.g. territory check). */
export type CarrierEligibilityFilter = (entityId: number) => boolean;

export interface IdleCarrierPoolConfig {
    gameState: GameState;
    carrierRegistry: CarrierRegistry;
    unitReservation: UnitReservationRegistry;
}

export class IdleCarrierPool {
    private readonly gameState: GameState;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly unitReservation: UnitReservationRegistry;

    constructor(config: IdleCarrierPoolConfig) {
        this.gameState = config.gameState;
        this.carrierRegistry = config.carrierRegistry;
        this.unitReservation = config.unitReservation;
    }

    /** Expose carrier ComponentStore for external iteration (e.g. RecruitSystem scan). */
    get carrierStore() {
        return this.carrierRegistry.store;
    }

    /** Check if a carrier is idle (no active job, not reserved). */
    isIdle(carrierId: number): boolean {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'IdleCarrierPool.isIdle');
        return entity.jobId == null && !this.unitReservation.isReserved(carrierId);
    }

    /**
     * Find the nearest available carrier for `player` near (nearX, nearY).
     * "Available" = not transport-busy, not reserved, passes optional filter.
     * Returns entity ID or null.
     */
    findNearest(nearX: number, nearY: number, player: number, filter?: CarrierEligibilityFilter): number | null {
        const result = this.findNearestWithCost(nearX, nearY, player, filter);
        return result ? result.carrierId : null;
    }

    /**
     * Find the nearest available carrier and return both the carrier ID and the
     * squared distance to (nearX, nearY). Useful when the caller needs to factor
     * carrier proximity into a larger cost comparison (e.g. total trip distance
     * across multiple source candidates).
     */
    findNearestWithCost(
        nearX: number,
        nearY: number,
        player: number,
        filter?: CarrierEligibilityFilter
    ): { carrierId: number; distSq: number } | null {
        let bestId: number | null = null;
        let bestDistSq = Infinity;

        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (!this.isAvailable(id, entity.player, entity.jobId, player, filter)) {
                continue;
            }

            const d = distSq(entity, { x: nearX, y: nearY });

            if (d < bestDistSq) {
                bestDistSq = d;
                bestId = id;
            }
        }

        return bestId !== null ? { carrierId: bestId, distSq: bestDistSq } : null;
    }

    private isAvailable(
        id: number,
        entityPlayer: number,
        entityJobId: number | undefined,
        player: number,
        filter?: CarrierEligibilityFilter
    ): boolean {
        return (
            entityPlayer === player &&
            entityJobId == null &&
            !this.unitReservation.isReserved(id) &&
            (!filter || filter(id))
        );
    }
}

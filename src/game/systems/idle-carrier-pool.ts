/**
 * IdleCarrierPool — nearest-available-carrier queries.
 *
 * "Available" means: not busy (entity.jobId == null), not reserved by another
 * feature (barracks, auto-recruit, garrison), and passes an optional filter.
 *
 * Spatial index: rebuilds idle carriers into a SpatialHash (same cell model as
 * SpatialGrid, without territory — carriers move, so the hash is rebuilt each
 * query batch via beginFrame()). Multiple findNearest* calls share one rebuild.
 * Candidates are re-checked for idle/reservation so mid-batch assigns stay correct.
 */

import type { GameState } from '../game-state';
import type { CarrierRegistry } from './carrier-registry';
import type { UnitReservationRegistry } from './unit-reservation';
import { SpatialHash } from '../spatial-hash';
import { query } from '../ecs';
import { distSq } from '../core/distance';

/** Optional caller-specific filter (e.g. territory check). */
export type CarrierEligibilityFilter = (entityId: number) => boolean;

export interface IdleCarrierPoolConfig {
    gameState: GameState;
    carrierRegistry: CarrierRegistry;
    unitReservation: UnitReservationRegistry;
}

/** Cap expand-radius search (tiles) so empty results do not run forever. */
const MAX_SEARCH_RADIUS = 4096;

export class IdleCarrierPool {
    private readonly gameState: GameState;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly unitReservation: UnitReservationRegistry;

    /**
     * Idle carriers only, rebuilt each beginFrame().
     * cellShift 4 (16-tile cells) matches SpatialGrid defaults.
     */
    private readonly hash = new SpatialHash(4);

    /** True after rebuild in the current query batch. */
    private indexReady = false;

    constructor(config: IdleCarrierPoolConfig) {
        this.gameState = config.gameState;
        this.carrierRegistry = config.carrierRegistry;
        this.unitReservation = config.unitReservation;
    }

    /** Expose carrier ComponentStore for external iteration (e.g. RecruitSystem scan). */
    get carrierStore() {
        return this.carrierRegistry.store;
    }

    /**
     * Invalidate the spatial index. Call once at the start of a tick (or query
     * batch) before findNearest* so positions and idle flags are fresh.
     * The next findNearest* rebuilds; further calls reuse the hash.
     */
    beginFrame(): void {
        this.indexReady = false;
    }

    /** Check if a carrier is idle (no active job, not reserved). */
    isIdle(carrierId: number): boolean {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'IdleCarrierPool.isIdle');
        return entity.jobId == null && !this.unitReservation.isReserved(carrierId);
    }

    /**
     * Find the nearest available carrier for `player` near (nearX, nearY).
     * Returns entity ID or null.
     */
    findNearest(nearX: number, nearY: number, player: number, filter?: CarrierEligibilityFilter): number | null {
        const result = this.findNearestWithCost(nearX, nearY, player, filter);
        return result ? result.carrierId : null;
    }

    /**
     * Find the nearest available carrier and squared distance to (nearX, nearY).
     * Expanding radius over SpatialHash.nearbyIds (same cell-range idea as SpatialGrid.nearby).
     */
    findNearestWithCost(
        nearX: number,
        nearY: number,
        player: number,
        filter?: CarrierEligibilityFilter
    ): { carrierId: number; distSq: number } | null {
        this.ensureIndex();
        if (this.hash.isEmpty) {
            return null;
        }

        const center = { x: nearX, y: nearY };
        let bestId: number | null = null;
        let bestDistSq = Infinity;
        let radius = 0;

        while (radius <= MAX_SEARCH_RADIUS) {
            const found = this.scanRadius(center, radius, player, filter, bestDistSq);
            if (found) {
                bestId = found.carrierId;
                bestDistSq = found.distSq;
            }
            // Stop when best is inside the axis-aligned square of half-width `radius`
            // (points outside have chebyshev dist > radius ⇒ euclidean > radius).
            if (bestId !== null && bestDistSq <= radius * radius) {
                break;
            }
            radius = radius === 0 ? this.hash.cellSize : radius + this.hash.cellSize;
        }

        return bestId !== null ? { carrierId: bestId, distSq: bestDistSq } : null;
    }

    /** Scan one radius shell of the spatial hash; return improvement over bestDistSq if any. */
    private scanRadius(
        center: { x: number; y: number },
        radius: number,
        player: number,
        filter: CarrierEligibilityFilter | undefined,
        bestDistSq: number
    ): { carrierId: number; distSq: number } | null {
        let bestId: number | null = null;
        let best = bestDistSq;

        for (const id of this.hash.nearbyIds(center, radius)) {
            const entity = this.gameState.getEntity(id);
            if (!entity || !this.isAvailable(id, entity.player, entity.jobId, player, filter)) {
                continue;
            }
            const d = distSq(entity, center);
            if (d < best) {
                best = d;
                bestId = id;
            }
        }

        return bestId !== null ? { carrierId: bestId, distSq: best } : null;
    }

    // ── Internal ────────────────────────────────────────────────

    private ensureIndex(): void {
        if (!this.indexReady) {
            this.rebuildIndex();
        }
    }

    /** Scan carriers; put currently-idle ones into the shared SpatialHash. */
    private rebuildIndex(): void {
        this.hash.clear();

        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (entity.jobId != null || this.unitReservation.isReserved(id)) {
                continue;
            }
            this.hash.add(id, entity);
        }

        this.indexReady = true;
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

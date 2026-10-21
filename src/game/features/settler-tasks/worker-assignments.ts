/**
 * WorkerAssignments — which unit works at which building.
 *
 * Owns the home-building assignment of every unit (`UnitRuntime.homeAssignment`),
 * per-building occupant counts and the by-building index. Provides the push-based
 * assignment API (building demand, recruit, garrison) and idle-specialist lookup.
 * Consumers use it directly via `SettlerTaskExports.workerAssignments`.
 */

import type { GameState } from '../../game-state';
import type { BuildingType } from '../../buildings/types';
import type { EventBus } from '../../event-bus';
import { UnitType, type Tile } from '../../entity';
import { createLogger } from '@/utilities/logger';
import { SettlerState, type WorkerAssignmentQuery } from './types';
import type { UnitRuntime, UnitRuntimeStore } from './unit-runtime';
import { relocateUnitsFromFootprints } from './initial-worker-assignment';
import { SettlerBuildingStatus, type ISettlerBuildingLocationManager } from '../settler-location';
import type { Index } from '@/game/utils/indexed-map';
import { distSq } from '@/game/core/distance';

const log = createLogger('WorkerAssignments');

/** Checks if two territory tiles are reachable through contiguous same-player territory. */
export type TerritoryConnectivityCheck = (a: Tile, b: Tile, player: number) => boolean;

export class WorkerAssignments implements WorkerAssignmentQuery {
    /** Tracks how many workers are assigned to each building (for occupancy limits). */
    private readonly occupants = new Map<number, number>();

    /** Settler ids by home building id. */
    private readonly byBuilding: Index<number, number>;

    constructor(
        private readonly runtimes: UnitRuntimeStore,
        private readonly locationManager: ISettlerBuildingLocationManager,
        private readonly gameState: GameState,
        private readonly eventBus: EventBus,
        private readonly territoryCheck: TerritoryConnectivityCheck
    ) {
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        this.byBuilding = runtimes.addIndex<number>((_id, runtime) => runtime.homeAssignment?.buildingId ?? null);
    }

    /** Get the assigned building ID for a settler, or null if unassigned. */
    getAssignedBuilding(settlerId: number): number | null {
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        return this.runtimes.get(settlerId)?.homeAssignment?.buildingId ?? null;
    }

    /** Get all settler IDs assigned to work at the given building. */
    getWorkersForBuilding(buildingId: number): ReadonlySet<number> {
        return this.byBuilding.get(buildingId);
    }

    /** Number of workers assigned to a building (occupancy limit checks). */
    getOccupantCount(buildingId: number): number {
        // eslint-disable-next-line no-restricted-syntax -- buildings with no assigned workers have no entry; 0 is correct
        return this.occupants.get(buildingId) ?? 0;
    }

    /** True while at least one worker is assigned to the building. */
    hasOccupants(buildingId: number): boolean {
        return this.occupants.has(buildingId);
    }

    /**
     * Assign a building to a worker, incrementing its occupant count.
     * Pure assignment — does NOT register location tracking.
     * Callers are responsible for calling markApproaching / enterBuilding separately.
     */
    private claim(settlerId: number, runtime: UnitRuntime, buildingId: number): void {
        runtime.homeAssignment = { buildingId, hasVisited: false };
        this.runtimes.reindex(settlerId);
        // eslint-disable-next-line no-restricted-syntax -- occupants map starts empty; absent entry means 0 current occupants
        this.occupants.set(buildingId, (this.occupants.get(buildingId) ?? 0) + 1);
    }

    /** Release a worker's building assignment, decrementing its occupant count. */
    release(settlerId: number, runtime: UnitRuntime): void {
        if (!runtime.homeAssignment) {
            return;
        }
        const buildingId = runtime.homeAssignment.buildingId;
        const count = this.occupants.get(buildingId);
        if (count === undefined) {
            throw new Error(`No occupant count for building ${buildingId} in WorkerAssignments.release`);
        }
        if (count <= 1) {
            this.occupants.delete(buildingId);
        } else {
            this.occupants.set(buildingId, count - 1);
        }

        if (this.locationManager.isInside(settlerId)) {
            this.locationManager.exitBuilding(settlerId);
        } else if (this.locationManager.isCommitted(settlerId)) {
            this.locationManager.cancelApproach(settlerId);
        }

        this.emitWorkerLost(buildingId, settlerId);

        runtime.homeAssignment = null;
        this.runtimes.reindex(settlerId);
    }

    /** Emit building:workerLost if the building still exists (not being destroyed). */
    private emitWorkerLost(buildingId: number, settlerId: number): void {
        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            return;
        }
        const player = building.player;
        const race = this.gameState.playerRaces.get(player);
        if (race === undefined) {
            return;
        }
        this.eventBus.emit('building:workerLost', {
            buildingId,
            buildingType: building.subType as BuildingType,
            unitId: settlerId,
            player,
            race,
            level: 'warn',
        });
    }

    /** Move units off building footprints so they aren't trapped. Called once after map load. */
    relocateFromFootprints(): void {
        relocateUnitsFromFootprints(this.gameState);
    }

    // ─────────────────────────────────────────────────────────────
    // Push-based worker assignment API (building demand, recruit, garrison)
    // ─────────────────────────────────────────────────────────────

    /**
     * Find nearest idle specialist of given type with no home assignment.
     * Returns entity ID or null.
     */
    findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null {
        let bestId: number | null = null;
        let bestDistSq = Infinity;

        for (const [entityId, runtime] of this.runtimes) {
            if (!this.isEligibleSpecialist(entityId, runtime, unitType, player, nearX, nearY)) {
                continue;
            }
            const entity = this.gameState.getEntity(entityId)!;
            const d = distSq(entity, { x: nearX, y: nearY });
            if (d < bestDistSq) {
                bestDistSq = d;
                bestId = entityId;
            }
        }

        return bestId;
    }

    private isEligibleSpecialist(
        entityId: number,
        runtime: UnitRuntime,
        unitType: UnitType,
        player: number,
        nearX: number,
        nearY: number
    ): boolean {
        if (runtime.state !== SettlerState.IDLE || runtime.homeAssignment !== null) {
            return false;
        }
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.subType !== unitType || entity.player !== player) {
            return false;
        }
        if (!this.territoryCheck(entity, { x: nearX, y: nearY }, player)) {
            return false;
        }
        return true;
    }

    /** Assign a settler to a building externally (from recruit system). */
    assignWorker(settlerId: number, buildingId: number): void {
        const runtime = this.runtimes.getOrCreate(settlerId);
        this.claim(settlerId, runtime, buildingId);
        if (!this.locationManager.isCommitted(settlerId)) {
            this.locationManager.markApproaching(settlerId, buildingId);
        }
    }

    /**
     * Assign a worker that was spawned already inside its building (hidden, no movement needed).
     * On restore, the locationStore PersistentMap may already have the Inside entry —
     * skip enterBuilding in that case to avoid a duplicate-entry throw.
     */
    assignWorkerInside(settlerId: number, buildingId: number): void {
        const runtime = this.runtimes.getOrCreate(settlerId);
        this.claim(settlerId, runtime, buildingId);
        runtime.homeAssignment!.hasVisited = true;
        if (!this.locationManager.isInside(settlerId, buildingId)) {
            this.locationManager.enterBuilding(settlerId, buildingId);
        }
    }

    /**
     * Release a settler's home building assignment without exiting or moving them.
     * Used by garrison: once the soldier is inside, garrison manager takes ownership
     * and the settler task system no longer tracks them as a building worker.
     */
    releaseAssignment(settlerId: number): void {
        const runtime = this.runtimes.getOrCreate(settlerId);
        if (!runtime.homeAssignment) {
            return;
        }
        const buildingId = runtime.homeAssignment.buildingId;
        // Cancel approach tracking if the settler was still approaching (not yet inside).
        // Settlers that are already Inside are managed by exitBuilding(), not here.
        const location = this.locationManager.getLocation(settlerId);
        if (location?.status === SettlerBuildingStatus.Approaching) {
            this.locationManager.cancelApproach(settlerId);
        }
        const count = this.occupants.get(buildingId);
        if (count !== undefined) {
            if (count <= 1) {
                this.occupants.delete(buildingId);
            } else {
                this.occupants.set(buildingId, count - 1);
            }
        }
        runtime.homeAssignment = null;
        this.runtimes.reindex(settlerId);
    }

    /**
     * Drop a settler's home assignment without occupant or location bookkeeping —
     * used when the building is gone or the location manager already ended the approach.
     */
    forgetHome(settlerId: number, runtime: UnitRuntime): void {
        runtime.homeAssignment = null;
        this.runtimes.reindex(settlerId);
    }

    /** Remove occupant tracking for a destroyed building (caller handles worker job interruption). */
    clearBuilding(buildingId: number): void {
        this.occupants.delete(buildingId);
        log.debug(`Building ${buildingId} cleared from occupant tracking`);
    }
}

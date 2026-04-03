/**
 * BuildingWorkerTracker — manages building↔worker assignment state.
 *
 * Extracted from SettlerTaskSystem to keep that file focused on task execution.
 * Tracks which workers are assigned to which buildings, handles occupancy counts,
 * and provides the push-based worker assignment API used by RecruitSystem.
 */

import type { GameState } from '../../game-state';
import type { BuildingType } from '../../buildings/types';
import type { EventBus } from '../../event-bus';
import { UnitType } from '../../entity';
import { createLogger } from '@/utilities/logger';
import { SettlerState } from './types';
import type { UnitRuntime } from './unit-state-machine';
import { relocateUnitsFromFootprints } from './initial-worker-assignment';
import { SettlerBuildingStatus, type ISettlerBuildingLocationManager } from '../settler-location';
import type { IndexedMap, Index } from '@/game/utils/indexed-map';
import { distSq } from '@/game/core/distance';

const log = createLogger('BuildingWorkerTracker');

export class BuildingWorkerTracker {
    /** Tracks how many workers are assigned to each building (for occupancy limits). */
    readonly occupants = new Map<number, number>();

    private readonly byBuilding: Index<number, number>;

    constructor(
        private readonly runtimes: IndexedMap<number, UnitRuntime>,
        private readonly getOrCreateRuntime: (entityId: number) => UnitRuntime,
        private readonly locationManager: ISettlerBuildingLocationManager,
        private readonly gameState: GameState,
        private readonly eventBus: EventBus,
        byBuilding: Index<number, number>
    ) {
        this.byBuilding = byBuilding;
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

    /**
     * Assign a building to a worker, incrementing its occupant count.
     * Pure assignment — does NOT register location tracking.
     * Callers are responsible for calling markApproaching / enterBuilding separately.
     */
    claim(settlerId: number, runtime: UnitRuntime, buildingId: number): void {
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
            throw new Error(`No occupant count for building ${buildingId} in BuildingWorkerTracker.release`);
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
    // Push-based worker assignment API (for RecruitSystem)
    // ─────────────────────────────────────────────────────────────

    /**
     * Find nearest idle specialist of given type with no home assignment.
     * Returns entity ID or null.
     */
    findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null {
        let bestId: number | null = null;
        let bestDistSq = Infinity;

        for (const [entityId, runtime] of this.runtimes) {
            if (runtime.state !== SettlerState.IDLE) {
                continue;
            }
            if (runtime.homeAssignment !== null) {
                continue;
            }

            const entity = this.gameState.getEntity(entityId);
            if (!entity) {
                continue;
            }
            if (entity.subType !== unitType) {
                continue;
            }
            if (entity.player !== player) {
                continue;
            }

            const d = distSq(entity.x, nearX, entity.y, nearY);
            if (d < bestDistSq) {
                bestDistSq = d;
                bestId = entityId;
            }
        }

        return bestId;
    }

    /** Assign a settler to a building externally (from recruit system). */
    assignWorker(settlerId: number, buildingId: number): void {
        const runtime = this.getOrCreateRuntime(settlerId);
        this.claim(settlerId, runtime, buildingId);
        if (!this.locationManager.isCommitted(settlerId)) {
            this.locationManager.markApproaching(settlerId, buildingId);
        }
    }

    /** Assign a worker that was spawned already inside its building (hidden, no movement needed). */
    assignWorkerInside(settlerId: number, buildingId: number): void {
        const runtime = this.getOrCreateRuntime(settlerId);
        this.claim(settlerId, runtime, buildingId);
        runtime.homeAssignment!.hasVisited = true;
        this.locationManager.enterBuilding(settlerId, buildingId);
    }

    /**
     * Release a settler's home building assignment without exiting or moving them.
     * Used by garrison: once the soldier is inside, garrison manager takes ownership
     * and the settler task system no longer tracks them as a building worker.
     */
    releaseAssignment(settlerId: number): void {
        const runtime = this.getOrCreateRuntime(settlerId);
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

    /** Remove occupant tracking for a destroyed building (caller handles worker job interruption). */
    clearBuilding(buildingId: number): void {
        this.occupants.delete(buildingId);
        log.debug(`Building ${buildingId} cleared from occupant tracking`);
    }
}

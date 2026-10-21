/**
 * Tower Garrison Manager
 *
 * Owns the runtime garrison state of garrison buildings (GuardTowerSmall, GuardTowerBig, Castle).
 *
 * Who owns a unit is the unit's commitment (docs/designs/job-ownership.md, "Garrison migration"):
 * - en route: a reserved `Garrison` job (ref = tower id) walking to the door and entering;
 * - garrisoned: a reserved `Garrison` hold (ref = tower id) — owned, no job runs.
 * The per-role slot sets here are derived state: filled on job completion, rebuilt from the holds
 * on restore, emptied on eject / tower removal / unit removal (via the hold owner callbacks).
 *
 * Responsibilities:
 * - Track which units are garrisoned in which building (per-role slot sets)
 * - Answer en-route queries from the Garrison job commitments
 * - Finalize garrison (hold the unit) and eject (release the hold, reveal the unit at the door)
 */

import type { Entity, Tile } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { EventBus } from '@/game/event-bus';
import type { CoreDeps } from '../feature';
import type { TerrainData } from '@/game/terrain';
import type { JobService, WorkerAssignments } from '@/game/features/settler-tasks';
import type { ISettlerBuildingLocationManager } from '@/game/features/settler-location';
import { JobKind } from '@/game/systems/choreo';
import { UnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { createLogger } from '@/utilities/logger';
import { findBuildingApproachTile } from '@/game/buildings/approach';
import { getGarrisonCapacity, getGarrisonRole } from './internal/garrison-capacity';
import { dispatchUnitToGarrison } from './internal/garrison-dispatch';
import type { BuildingGarrisonState, GarrisonSlotSet } from './types';

const log = createLogger('TowerGarrisonManager');

export interface TowerGarrisonManagerConfig extends CoreDeps {
    terrain: TerrainData;
    jobs: JobService;
    locationManager: ISettlerBuildingLocationManager;
    workerAssignments: WorkerAssignments;
}

export class TowerGarrisonManager {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly jobs: JobService;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly workerAssignments: WorkerAssignments;
    private readonly terrain: TerrainData;

    /** Per-tower garrison state. Keyed by building entity ID. */
    private readonly garrisons = new Map<number, BuildingGarrisonState>();

    /**
     * Tracks unit→tower pairs where pathfinding failed, preventing repeated
     * dispatch attempts to unreachable towers. Keyed by `${unitId}:${towerId}`.
     */
    private readonly failedDispatches = new Set<string>();

    constructor(config: TowerGarrisonManagerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.terrain = config.terrain;
        this.jobs = config.jobs;
        this.locationManager = config.locationManager;
        this.workerAssignments = config.workerAssignments;
    }

    /** Record that pathfinding failed for a unit→tower dispatch. */
    recordDispatchFailure(unitId: number, towerId: number): void {
        this.failedDispatches.add(`${unitId}:${towerId}`);
    }

    /** Check if a unit→tower dispatch previously failed (pathfinding unreachable). */
    hasDispatchFailed(unitId: number, towerId: number): boolean {
        return this.failedDispatches.has(`${unitId}:${towerId}`);
    }

    // =========================================================================
    // Tower lifecycle
    // =========================================================================

    /**
     * Register a garrison building. Creates empty slot sets based on capacity.
     * Throws if buildingType has no garrison capacity (programming error — caller
     * must check with getGarrisonCapacity before calling initTower).
     */
    initTower(buildingId: number, buildingType: BuildingType): void {
        const capacity = getGarrisonCapacity(buildingType);
        if (!capacity) {
            throw new Error(`TowerGarrisonManager.initTower: building type ${buildingType} has no garrison capacity`);
        }

        this.garrisons.set(buildingId, {
            buildingId,
            swordsmanSlots: { max: capacity.swordsmanSlots, unitIds: [] },
            bowmanSlots: { max: capacity.bowmanSlots, unitIds: [] },
        });

        log.debug(`Tower ${buildingId} (${buildingType}) registered`);
    }

    /**
     * Unregister a garrison building. Releases all garrisoned units at the door and cancels the
     * jobs of all en-route units. No-op if not a garrison building.
     */
    removeTower(buildingId: number): void {
        const garrison = this.garrisons.get(buildingId);
        if (!garrison) {
            return;
        }

        const tower = this.gameState.getEntityOrThrow(buildingId, 'TowerGarrisonManager.removeTower');

        // Release all garrisoned units — location manager already unhid them (it fires first)
        for (const unitId of [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds]) {
            const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.removeTower');
            this.jobs.releaseHold(unitId, JobKind.Garrison);
            // entity.hidden = false is handled by locationManager.onBuildingRemoved (fires before this)
            this.placeAtApproach(unit, tower);
            this.eventBus.emit('garrison:unitExited', { buildingId, unitId, unitType: unit.subType as UnitType });
        }

        // En-route jobs usually failed already (approachInterrupted → lifecycle); cancel is a no-op then.
        for (const unitId of this.enRouteUnits(buildingId)) {
            this.cancelEnRoute(unitId);
        }

        this.garrisons.delete(buildingId);
        log.debug(`Tower ${buildingId} removed, garrison released`);
    }

    // =========================================================================
    // Restore
    // =========================================================================

    /**
     * Rebuild the slot sets from the restored Garrison holds. Called from onRestoreComplete after
     * initTower has registered all towers. En-route Garrison jobs resume by themselves (Core).
     * Slot order after a load is ascending unit id.
     */
    rebuildFromHolds(): void {
        for (const unitId of this.jobs.commitments.unitsOwnedBy(JobKind.Garrison)) {
            const commitment = this.jobs.commitments.get(unitId)!;
            if (commitment.hasJob) {
                continue;
            }
            this.slotsFor(unitId, this.garrisons.get(commitment.ref)!).unitIds.push(unitId);
        }
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /** Get the current garrison state for a tower, or undefined if not registered. */
    getGarrison(buildingId: number): Readonly<BuildingGarrisonState> | undefined {
        return this.garrisons.get(buildingId);
    }

    /** Returns true if this unit is currently walking to any tower. */
    isEnRoute(unitId: number): boolean {
        return this.getTowerIdForEnRouteUnit(unitId) !== undefined;
    }

    /** Returns the tower ID this unit is walking to, or undefined if not en-route. */
    getTowerIdForEnRouteUnit(unitId: number): number | undefined {
        const commitment = this.jobs.commitments.get(unitId);
        if (commitment === undefined || commitment.owner !== JobKind.Garrison || !commitment.hasJob) {
            return undefined;
        }
        return commitment.ref;
    }

    /**
     * Returns how many en-route units are committed to each role slot for the given tower.
     * Used by slot-availability checks to prevent over-committing slots before units arrive.
     */
    getEnRouteSlotCounts(buildingId: number): { swordsman: number; bowman: number } {
        let swordsman = 0;
        let bowman = 0;
        for (const unitId of this.enRouteUnits(buildingId)) {
            const unit = this.gameState.getEntityOrThrow(unitId, 'en-route garrison unit');
            const role = getGarrisonRole(unit.subType as UnitType);
            if (role === 'swordsman') {
                swordsman++;
            } else if (role === 'bowman') {
                bowman++;
            }
        }
        return { swordsman, bowman };
    }

    /**
     * Returns true iff the given unit type fits in an available slot of this tower.
     * False if: no garrison entry, no role defined, or the matching role's slots are full.
     */
    canFitUnit(buildingId: number, unitType: UnitType): boolean {
        const garrison = this.garrisons.get(buildingId);
        if (!garrison) {
            return false;
        }

        const role = getGarrisonRole(unitType);
        if (!role) {
            return false;
        }

        const slots = role === 'swordsman' ? garrison.swordsmanSlots : garrison.bowmanSlots;
        return slots.unitIds.length < slots.max;
    }

    /**
     * Returns true iff this tower is completely empty (0 garrisoned, 0 en-route).
     * Used by auto-garrison to decide whether to send a soldier.
     */
    needsAutoGarrison(buildingId: number): boolean {
        if (!this.garrisons.has(buildingId)) {
            return false;
        }
        // Garrisoned units are Garrison holds, en-route units Garrison jobs — both are owned units.
        return this.jobs.commitments.unitsOwnedBy(JobKind.Garrison, buildingId).length === 0;
    }

    /**
     * Cancel the Garrison jobs of the given player's units walking to this tower.
     * Called when a tower changes ownership — the old player's units stop walking to an enemy building.
     */
    cancelEnRouteUnitsOf(buildingId: number, player: number): void {
        for (const unitId of this.enRouteUnits(buildingId)) {
            if (this.gameState.getEntityOrThrow(unitId, 'en-route garrison unit').player === player) {
                this.cancelEnRoute(unitId);
            }
        }
    }

    // =========================================================================
    // Dispatch / en-route
    // =========================================================================

    /** Send a unit to walk to the tower door and enter (a Garrison job). False if unreachable. */
    dispatchUnitToGarrison(unitId: number, towerId: number): boolean {
        return dispatchUnitToGarrison(unitId, towerId, {
            gameState: this.gameState,
            terrain: this.terrain,
            jobs: this.jobs,
            workerAssignments: this.workerAssignments,
        });
    }

    /** A unit's Garrison job ended without entering (failed / preempted / removed tower): drop its approach. */
    releaseEnRoute(unitId: number): void {
        this.workerAssignments.releaseAssignment(unitId);
        this.locationManager.cancelApproach(unitId);
    }

    // =========================================================================
    // Garrison finalization / ejection
    // =========================================================================

    /**
     * Finalize garrison for a unit that has entered the tower.
     * - Holds the unit (reserved Garrison hold, ref = tower)
     * - Adds to the correct role slot
     * - Releases worker assignment (garrison manager now owns this unit)
     * - Emits garrison:unitEntered
     *
     * Called by the Garrison job's onCompleted (commitment already cleared)
     * or directly by executeFillGarrisonCommand (instant spawn path).
     */
    finalizeGarrison(unitId: number, towerId: number): void {
        const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.finalizeGarrison');
        const tower = this.gameState.getEntityOrThrow(towerId, 'TowerGarrisonManager.finalizeGarrison');
        const garrison = this.garrisons.get(towerId);
        if (!garrison) {
            throw new Error(`TowerGarrisonManager.finalizeGarrison: tower ${towerId} not registered`);
        }

        // Reject entry if it would mix enemy and friendly units in the same garrison:
        // - Enemy entering an occupied garrison (friendly got there first)
        // - Friendly entering a garrison that contains an enemy (capture in progress)
        if (this.hasHostileOccupant(garrison, unit.player)) {
            this.workerAssignments.releaseAssignment(unitId);
            this.locationManager.exitBuilding(unitId);
            this.placeAtApproach(unit, tower);
            log.debug(`Unit ${unitId} rejected from tower ${towerId} — hostile unit already inside`);
            return;
        }

        this.slotsFor(unitId, garrison).unitIds.push(unitId);
        this.jobs.hold(unitId, JobKind.Garrison, towerId, true);

        // Release the worker assignment — the Garrison hold now owns this unit.
        // This prevents job completion from exiting the building.
        this.workerAssignments.releaseAssignment(unitId);

        this.eventBus.emit('garrison:unitEntered', { buildingId: towerId, unitId, unitType: unit.subType as UnitType });
        log.debug(`Unit ${unitId} garrisoned in tower ${towerId}`);
    }

    /** Hold owner: a garrisoned unit was removed (killed, etc.) — free its slot. */
    onGarrisonedUnitRemoved(unitId: number, towerId: number): void {
        this.removeFromSlots(unitId, towerId);
        log.debug(`Garrisoned unit ${unitId} removed externally, slot cleared`);
    }

    /** Hold owner: another owner took a garrisoned unit — it leaves the tower (hold already gone). */
    onGarrisonedUnitPreempted(unitId: number, towerId: number): void {
        this.vacate(unitId, towerId);
        log.debug(`Garrisoned unit ${unitId} taken over by another owner — left tower ${towerId}`);
    }

    /**
     * Eject a garrisoned unit from a tower.
     * - Releases the Garrison hold
     * - Removes from slot set
     * - Shows the entity at the tower door tile
     * - Emits garrison:unitExited
     */
    ejectUnit(unitId: number, towerId: number): void {
        this.jobs.releaseHold(unitId, JobKind.Garrison);
        this.vacate(unitId, towerId);
        log.debug(`Unit ${unitId} ejected from tower ${towerId}`);
    }

    // =========================================================================
    // Approach tile
    // =========================================================================

    /**
     * Find the best walkable tile from which a unit can approach this building
     * (garrisoning, attacking, occupying, etc.).
     *
     * Checks the door tile first, then searches EXTENDED_OFFSETS. Falls back
     * to the door position if no free tile is found.
     */
    getApproachTile(building: Entity): Tile {
        return findBuildingApproachTile(building, this.terrain, this.gameState);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /** Units running a Garrison job to this tower (ascending ids). */
    private enRouteUnits(towerId: number): number[] {
        return this.jobs.commitments
            .unitsOwnedBy(JobKind.Garrison, towerId)
            .filter(id => this.jobs.commitments.get(id)!.hasJob);
    }

    private cancelEnRoute(unitId: number): void {
        this.jobs.cancel(unitId, JobKind.Garrison);
        this.releaseEnRoute(unitId);
    }

    /** Remove from the slot set, exit the building at the door and notify. The hold is already gone. */
    private vacate(unitId: number, towerId: number): void {
        this.removeFromSlots(unitId, towerId);
        const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.vacate');
        this.locationManager.exitBuilding(unitId);
        this.eventBus.emit('garrison:unitExited', { buildingId: towerId, unitId, unitType: unit.subType as UnitType });
    }

    private removeFromSlots(unitId: number, towerId: number): void {
        const garrison = this.garrisons.get(towerId);
        if (!garrison) {
            throw new Error(`TowerGarrisonManager: tower ${towerId} not registered`);
        }
        if (!removeFromArray(garrison.swordsmanSlots.unitIds, unitId)) {
            if (!removeFromArray(garrison.bowmanSlots.unitIds, unitId)) {
                throw new Error(`TowerGarrisonManager: unit ${unitId} not found in tower ${towerId}`);
            }
        }
    }

    private slotsFor(unitId: number, garrison: BuildingGarrisonState): GarrisonSlotSet {
        const unit = this.gameState.getEntityOrThrow(unitId, 'garrison unit');
        const role = getGarrisonRole(unit.subType as UnitType);
        if (!role) {
            throw new Error(`TowerGarrisonManager: unit ${unitId} (${unit.subType}) has no garrison role`);
        }
        return role === 'swordsman' ? garrison.swordsmanSlots : garrison.bowmanSlots;
    }

    /** Returns true if any unit inside the garrison belongs to a different player. */
    private hasHostileOccupant(garrison: BuildingGarrisonState, enteringPlayer: number): boolean {
        const allIds = [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds];
        return allIds.some(id => this.gameState.getEntityOrThrow(id, 'garrisoned unit').player !== enteringPlayer);
    }

    private placeAtApproach(unit: Entity, building: Entity): void {
        const pos = this.getApproachTile(building);
        unit.x = pos.x;
        unit.y = pos.y;
    }
}

// =========================================================================
// Module-level helpers
// =========================================================================

/** Remove a value from an array in-place. Returns true if the value was found and removed. */
function removeFromArray(arr: number[], value: number): boolean {
    const index = arr.indexOf(value);
    if (index === -1) {
        return false;
    }
    arr.splice(index, 1);
    return true;
}

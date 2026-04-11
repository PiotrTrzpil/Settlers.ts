/**
 * Tower Garrison Manager
 *
 * Owns all runtime garrison state and en-route tracking for garrison buildings
 * (GuardTowerSmall, GuardTowerBig, Castle). Implements persistence for both.
 *
 * Responsibilities:
 * - Track which units are garrisoned in which building (per-role slot sets)
 * - Track which units are en-route to garrison (walking to door)
 * - Reserve/release units in UnitReservationRegistry throughout the lifecycle
 * - Finalize garrison (hide unit) and eject (reveal unit at door)
 * - Clean up silently when units are removed externally
 */

import type { Entity, Tile } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { EventBus } from '@/game/event-bus';
import type { CoreDeps } from '../feature';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import type { TerrainData } from '@/game/terrain';
import { SettlerBuildingStatus, type ISettlerBuildingLocationManager } from '@/game/features/settler-location';
import { UnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { createLogger } from '@/utilities/logger';
import { findBuildingApproachTile } from '@/game/buildings/approach';
import { getGarrisonCapacity, getGarrisonRole } from './internal/garrison-capacity';
import type { BuildingGarrisonState, GarrisonJobRecord } from './types';
import { clearJobId } from '@/game/entity';
import { PersistentMap } from '@/game/persistence/persistent-store';

const log = createLogger('TowerGarrisonManager');

export interface TowerGarrisonManagerConfig extends CoreDeps {
    unitReservation: UnitReservationRegistry;
    locationManager: ISettlerBuildingLocationManager;
    releaseWorkerAssignment: (settlerId: number) => void;
}

export class TowerGarrisonManager {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly releaseWorkerAssignment: (settlerId: number) => void;
    private terrain: TerrainData | null = null;

    /** Per-tower garrison state. Keyed by building entity ID. */
    private readonly garrisons = new Map<number, BuildingGarrisonState>();

    /** Maps unitId → GarrisonJobRecord for all currently garrisoned units. Persisted. */
    readonly garrisonJobs: PersistentMap<GarrisonJobRecord>;

    /**
     * Tracks unit→tower pairs where pathfinding failed, preventing repeated
     * dispatch attempts to unreachable towers. Keyed by `${unitId}:${towerId}`.
     * Cleared on terrain changes (paths may open up).
     */
    private readonly failedDispatches = new Set<string>();

    constructor(config: TowerGarrisonManagerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.unitReservation = config.unitReservation;
        this.locationManager = config.locationManager;
        this.releaseWorkerAssignment = config.releaseWorkerAssignment;
        this.garrisonJobs = new PersistentMap<GarrisonJobRecord>('garrisonJobs');

        // Finalize garrison on task completion — NOT on settler-location:entered.
        // ENTER_BUILDING calls enterBuilding() (hiding the unit) then returns DONE,
        // which triggers completeJob → clearJobId → emits settler:taskCompleted.
        // We listen here so the garrison jobId is set AFTER completeJob clears the old one.
        this.eventBus.on('settler:taskCompleted', ({ unitId: settlerId }) => {
            const location = this.locationManager.getLocation(settlerId);
            if (!location) {
                return;
            }
            const garrison = this.garrisons.get(location.buildingId);
            if (!garrison) {
                return;
            }

            const unit = this.gameState.getEntityOrThrow(settlerId, 'unit entering garrison building');
            const role = getGarrisonRole(unit.subType as UnitType);
            if (!role) {
                return;
            }

            this.finalizeGarrison(settlerId, location.buildingId);
        });

        this.eventBus.on('settler-location:approachInterrupted', ({ unitId: settlerId }) => {
            if (!this.unitReservation.isReserved(settlerId)) {
                return;
            }
            this.unitReservation.release(settlerId);
            log.debug(`Unit ${settlerId} approach interrupted — reservation released`);
        });
    }

    setTerrain(terrain: TerrainData): void {
        this.terrain = terrain;
        this.failedDispatches.clear();
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
     * Unregister a garrison building. Ejects all garrisoned units and cancels all
     * en-route units, releasing their reservations. No-op if not a garrison building.
     */
    removeTower(buildingId: number): void {
        const garrison = this.garrisons.get(buildingId);
        if (!garrison) {
            return;
        }

        const tower = this.gameState.getEntityOrThrow(buildingId, 'TowerGarrisonManager.removeTower');

        // Eject all garrisoned units — location manager already unhid them (it fires first)
        for (const unitId of [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds]) {
            const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.removeTower');
            this.releaseGarrisonedUnit(unitId, tower);
            this.eventBus.emit('garrison:unitExited', { buildingId, unitId, unitType: unit.subType as UnitType });
        }

        // En-route units are handled by settler-location:approachInterrupted (emitted by location manager)

        this.garrisons.delete(buildingId);
        log.debug(`Tower ${buildingId} removed, garrison released`);
    }

    // =========================================================================
    // Restore helpers
    // =========================================================================

    /**
     * Rebuild garrison slots and reservations from the persisted garrisonJobs map.
     * Called from onRestoreComplete after initTower has registered all towers.
     * The garrisonJobs PersistentMap is already deserialized at this point.
     */
    rebuildFromGarrisonJobs(): void {
        for (const [unitId, record] of this.garrisonJobs.entries()) {
            const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.rebuildFromGarrisonJobs');
            const garrison = this.garrisons.get(record.buildingId)!;
            const role = getGarrisonRole(unit.subType as UnitType)!;

            const slots = role === 'swordsman' ? garrison.swordsmanSlots : garrison.bowmanSlots;
            slots.unitIds.push(unitId);

            this.unitReservation.reserve(unitId, {
                purpose: 'garrison',
                onForcedRelease: id => this.handleForcedRelease(id, record.buildingId),
            });
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
        const location = this.locationManager.getLocation(unitId);
        return (
            location !== undefined &&
            location.status === SettlerBuildingStatus.Approaching &&
            this.garrisons.has(location.buildingId)
        );
    }

    /** Returns the tower ID this unit is walking to, or undefined if not en-route. */
    getTowerIdForEnRouteUnit(unitId: number): number | undefined {
        const location = this.locationManager.getLocation(unitId);
        if (location === undefined || location.status !== SettlerBuildingStatus.Approaching) {
            return undefined;
        }
        if (!this.garrisons.has(location.buildingId)) {
            return undefined;
        }
        return location.buildingId;
    }

    /**
     * Returns how many en-route units are committed to each role slot for the given tower.
     * Used by slot-availability checks to prevent over-committing slots before units arrive.
     */
    getEnRouteSlotCounts(buildingId: number): { swordsman: number; bowman: number } {
        let swordsman = 0;
        let bowman = 0;
        for (const unitId of this.locationManager.getApproaching(buildingId)) {
            const unit = this.gameState.getEntity(unitId);
            if (!unit) {
                continue;
            }
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
     * Returns a snapshot of all en-route entries.
     * Safe to iterate while the en-route map is being modified (e.g. post-load re-dispatch).
     */
    getEnRouteEntries(): Array<{ unitId: number; towerId: number }> {
        const result: Array<{ unitId: number; towerId: number }> = [];
        for (const [buildingId] of this.garrisons) {
            for (const unitId of this.locationManager.getApproaching(buildingId)) {
                result.push({ unitId, towerId: buildingId });
            }
        }
        return result;
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
        const garrison = this.garrisons.get(buildingId);
        if (!garrison) {
            return false;
        }

        const totalGarrisoned = garrison.swordsmanSlots.unitIds.length + garrison.bowmanSlots.unitIds.length;
        if (totalGarrisoned > 0) {
            return false;
        }

        return this.locationManager.getApproaching(buildingId).length === 0;
    }

    /**
     * Cancel all en-route units for a building that belong to a specific player.
     * Called when a tower changes ownership — the old player's approaching units
     * should stop walking to an enemy building.
     * Returns the cancelled unit IDs for external cleanup (reservation, worker assignment).
     */
    getCancelledEnRouteUnits(buildingId: number, player: number): number[] {
        const approaching = this.locationManager.getApproaching(buildingId);
        const cancelled: number[] = [];
        for (const unitId of approaching) {
            const unit = this.gameState.getEntity(unitId);
            if (unit && unit.player === player) {
                cancelled.push(unitId);
            }
        }
        return cancelled;
    }

    // =========================================================================
    // Garrison finalization / ejection
    // =========================================================================

    /**
     * Finalize garrison for a unit that has entered the tower.
     * - Transitions reservation to garrisoned
     * - Adds to the correct role slot
     * - Releases worker assignment (garrison manager now owns this unit)
     * - Emits garrison:unitEntered
     *
     * Called from settler:taskCompleted (after completeJob clears the choreo jobId)
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
            this.unitReservation.release(unitId);
            this.releaseWorkerAssignment(unitId);
            this.locationManager.exitBuilding(unitId);
            this.placeAtApproach(unit, tower);
            log.debug(`Unit ${unitId} rejected from tower ${towerId} — hostile unit already inside`);
            return;
        }

        this.unitReservation.updateReservation(unitId, {
            purpose: 'garrison',
            onForcedRelease: id => this.handleForcedRelease(id, towerId),
        });

        const role = getGarrisonRole(unit.subType as UnitType);
        if (!role) {
            throw new Error(`TowerGarrisonManager.finalizeGarrison: unit ${unitId} has no garrison role`);
        }

        const slots = role === 'swordsman' ? garrison.swordsmanSlots : garrison.bowmanSlots;
        slots.unitIds.push(unitId);

        // Allocate a garrison jobId. completeJob already cleared the WORKER_DISPATCH
        // jobId before settler:taskCompleted fired, so entity.jobId is undefined here.
        const jobId = this.gameState.allocateJobId();
        unit.jobId = jobId;
        this.garrisonJobs.set(unitId, { jobId, unitId, buildingId: towerId });

        // Release the worker assignment — garrison manager now owns this unit.
        // This prevents completeJob from exiting the building.
        this.releaseWorkerAssignment(unitId);

        this.eventBus.emit('garrison:unitEntered', { buildingId: towerId, unitId, unitType: unit.subType as UnitType });
        log.debug(`Unit ${unitId} garrisoned in tower ${towerId} (${role} slot)`);
    }

    /** Handle a garrisoned unit being forcefully removed (killed, etc.). */
    private handleForcedRelease(unitId: number, towerId: number): void {
        const g = this.garrisons.get(towerId);
        if (!g) {
            return;
        }
        const unit = this.gameState.getEntity(unitId);
        if (unit) {
            clearJobId(unit);
        }
        this.garrisonJobs.delete(unitId);
        removeFromArray(g.swordsmanSlots.unitIds, unitId);
        removeFromArray(g.bowmanSlots.unitIds, unitId);
        log.debug(`Garrisoned unit ${unitId} removed externally, slot cleared`);
    }

    /** Returns true if any unit inside the garrison belongs to a different player. */
    private hasHostileOccupant(garrison: BuildingGarrisonState, enteringPlayer: number): boolean {
        const allIds = [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds];
        for (const id of allIds) {
            const occupant = this.gameState.getEntity(id);
            if (occupant && occupant.player !== enteringPlayer) {
                return true;
            }
        }
        return false;
    }

    /**
     * Eject a garrisoned unit from a tower.
     * - Removes from slot set
     * - Releases reservation
     * - Shows the entity at the tower door tile
     * - Emits garrison:unitExited
     */
    ejectUnit(unitId: number, towerId: number): void {
        const garrison = this.garrisons.get(towerId);
        if (!garrison) {
            throw new Error(`TowerGarrisonManager.ejectUnit: tower ${towerId} not registered`);
        }

        const removedFromSwordsman = removeFromArray(garrison.swordsmanSlots.unitIds, unitId);
        if (!removedFromSwordsman) {
            const removedFromBowman = removeFromArray(garrison.bowmanSlots.unitIds, unitId);
            if (!removedFromBowman) {
                throw new Error(`TowerGarrisonManager.ejectUnit: unit ${unitId} not found in tower ${towerId}`);
            }
        }

        const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.ejectUnit');
        clearJobId(unit);
        this.garrisonJobs.delete(unitId);
        this.unitReservation.release(unitId);
        this.locationManager.exitBuilding(unitId);

        this.eventBus.emit('garrison:unitExited', { buildingId: towerId, unitId, unitType: unit.subType as UnitType });
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
     * to the door position if terrain is not yet set or no free tile is found.
     */
    getApproachTile(building: Entity): Tile {
        if (!this.terrain) {
            log.warn(`getApproachTile: terrain not set for building ${building.id} — falling back to door pos`);
            return getBuildingDoorPos(building, building.race, building.subType as BuildingType);
        }
        return findBuildingApproachTile(building, this.terrain, this.gameState);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private releaseGarrisonedUnit(unitId: number, tower: Entity): void {
        const unit = this.gameState.getEntity(unitId);
        if (!unit) {
            return;
        } // May have been removed externally already

        clearJobId(unit);
        this.garrisonJobs.delete(unitId);
        this.unitReservation.release(unitId);
        // entity.hidden = false is handled by locationManager.onBuildingRemoved (fires before this)
        this.placeAtApproach(unit, tower);
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

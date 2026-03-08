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

import type { Entity } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { EventBus } from '@/game/event-bus';
import type { CoreDeps } from '../feature';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import type { Persistable } from '@/game/persistence';
import type { TerrainData } from '@/game/terrain';
import type { ISettlerBuildingLocationManager } from '@/game/features/settler-location/types';
import { SettlerBuildingStatus } from '@/game/features/settler-location/types';
import { UnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { sortedEntries } from '@/utilities/collections';
import { createLogger } from '@/utilities/logger';
import { findBuildingApproachTile } from '@/game/buildings/approach';
import { getGarrisonCapacity, getGarrisonRole } from './internal/garrison-capacity';
import type { BuildingGarrisonState, SerializedTowerGarrison } from './types';

const log = createLogger('TowerGarrisonManager');

/** Chebyshev distance threshold for "unit is at the tower door". */
const DOOR_ARRIVAL_DISTANCE = 1;

export interface TowerGarrisonManagerConfig extends CoreDeps {
    unitReservation: UnitReservationRegistry;
    locationManager: ISettlerBuildingLocationManager;
}

export class TowerGarrisonManager implements Persistable<SerializedTowerGarrison> {
    readonly persistKey = 'towerGarrison' as const;

    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private terrain: TerrainData | null = null;

    /** Per-tower garrison state. Keyed by building entity ID. */
    private readonly garrisons = new Map<number, BuildingGarrisonState>();

    constructor(config: TowerGarrisonManagerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.unitReservation = config.unitReservation;
        this.locationManager = config.locationManager;

        this.eventBus.on('settler-location:approachInterrupted', ({ settlerId }) => {
            if (!this.unitReservation.isReserved(settlerId)) return;
            // Only handle units that are en-route to a tower (reserved with garrison-en-route purpose).
            // The reservation was set by markEnRoute; we release it now since the approach was interrupted.
            this.unitReservation.release(settlerId);
            log.debug(`Unit ${settlerId} approach interrupted — reservation released`);
        });
    }

    setTerrain(terrain: TerrainData): void {
        this.terrain = terrain;
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
            throw new Error(
                `TowerGarrisonManager.initTower: building type ${BuildingType[buildingType]} has no garrison capacity`
            );
        }

        this.garrisons.set(buildingId, {
            buildingId,
            swordsmanSlots: { max: capacity.swordsmanSlots, unitIds: [] },
            bowmanSlots: { max: capacity.bowmanSlots, unitIds: [] },
        });

        log.debug(`Tower ${buildingId} (${BuildingType[buildingType]}) registered`);
    }

    /**
     * Unregister a garrison building. Ejects all garrisoned units and cancels all
     * en-route units, releasing their reservations. No-op if not a garrison building.
     */
    removeTower(buildingId: number): void {
        const garrison = this.garrisons.get(buildingId);
        if (!garrison) return;

        const tower = this.gameState.getEntityOrThrow(buildingId, 'TowerGarrisonManager.removeTower');

        // Eject all garrisoned units — location manager already unhid them (it fires first)
        for (const unitId of [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds]) {
            this.releaseGarrisonedUnit(unitId, tower);
            this.eventBus.emit('garrison:unitExited', { buildingId, unitId });
        }

        // En-route units are handled by settler-location:approachInterrupted (emitted by location manager)

        this.garrisons.delete(buildingId);
        log.debug(`Tower ${buildingId} removed, garrison released`);
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
        return location !== null && location.status === SettlerBuildingStatus.Approaching;
    }

    /** Returns the tower ID this unit is walking to, or undefined if not en-route. */
    getTowerIdForEnRouteUnit(unitId: number): number | undefined {
        const location = this.locationManager.getLocation(unitId);
        if (location === null || location.status !== SettlerBuildingStatus.Approaching) return undefined;
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
            if (!unit) continue;
            const role = getGarrisonRole(unit.subType as UnitType);
            if (role === 'swordsman') swordsman++;
            else if (role === 'bowman') bowman++;
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
        if (!garrison) return false;

        const role = getGarrisonRole(unitType);
        if (!role) return false;

        const slots = role === 'swordsman' ? garrison.swordsmanSlots : garrison.bowmanSlots;
        return slots.unitIds.length < slots.max;
    }

    /**
     * Returns true iff this tower is completely empty (0 garrisoned, 0 en-route).
     * Used by auto-garrison to decide whether to send a soldier.
     */
    needsAutoGarrison(buildingId: number): boolean {
        const garrison = this.garrisons.get(buildingId);
        if (!garrison) return false;

        const totalGarrisoned = garrison.swordsmanSlots.unitIds.length + garrison.bowmanSlots.unitIds.length;
        if (totalGarrisoned > 0) return false;

        return this.locationManager.getApproaching(buildingId).length === 0;
    }

    // =========================================================================
    // En-route transitions
    // =========================================================================

    /**
     * Mark a unit as en-route to a tower. Reserves the unit immediately so
     * player move commands cannot interrupt it during transit.
     */
    markEnRoute(unitId: number, towerId: number): void {
        this.unitReservation.reserve(unitId, {
            purpose: 'garrison-en-route',
            onForcedRelease: id => {
                log.debug(`En-route unit ${id} removed externally, reservation auto-released`);
            },
        });
        this.locationManager.markApproaching(unitId, towerId);
        log.debug(`Unit ${unitId} marked en-route to tower ${towerId}`);
    }

    /**
     * Cancel an en-route unit (e.g., movement failed or tower disappeared).
     * Releases the reservation and removes the en-route tracking.
     */
    cancelEnRoute(unitId: number): void {
        this.locationManager.cancelApproach(unitId);
        this.unitReservation.release(unitId);
        log.debug(`Unit ${unitId} en-route cancelled`);
    }

    // =========================================================================
    // Garrison finalization / ejection
    // =========================================================================

    /**
     * If the unit is within Chebyshev distance <= 1 of the tower door, finalizes
     * the garrison immediately and returns true. Returns false if not close enough.
     *
     * Single source of truth for the "at the door" check — used both from the
     * garrison command (unit already standing there) and the arrival detector
     * (unit stopped moving after walking).
     */
    tryFinalizeAtDoor(unitId: number, towerId: number): boolean {
        const tower = this.gameState.getEntityOrThrow(towerId, 'TowerGarrisonManager.tryFinalizeAtDoor');
        const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.tryFinalizeAtDoor');
        const door = getBuildingDoorPos(tower.x, tower.y, tower.race, tower.subType as BuildingType);
        const chebyshev = Math.max(Math.abs(unit.x - door.x), Math.abs(unit.y - door.y));
        if (chebyshev > DOOR_ARRIVAL_DISTANCE) return false;
        this.finalizeGarrison(unitId, towerId);
        return true;
    }

    /**
     * Finalize garrison for a unit that has arrived at the tower door.
     * - Removes from enRoute
     * - Transitions reservation from en-route to garrisoned (atomic update — no gap)
     * - Adds to the correct role slot
     * - Hides the entity
     * - Emits garrison:unitEntered
     */
    finalizeGarrison(unitId: number, towerId: number): void {
        // Atomically transition reservation from en-route to garrisoned,
        // so the unit is never momentarily unreserved between the two states.
        this.unitReservation.updateReservation(unitId, {
            purpose: 'garrison',
            onForcedRelease: id => {
                const garrison = this.garrisons.get(towerId);
                if (!garrison) return;
                removeFromArray(garrison.swordsmanSlots.unitIds, id);
                removeFromArray(garrison.bowmanSlots.unitIds, id);
                log.debug(`Garrisoned unit ${id} removed externally, slot cleared`);
            },
        });

        const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.finalizeGarrison');
        const garrison = this.garrisons.get(towerId);
        if (!garrison) {
            throw new Error(`TowerGarrisonManager.finalizeGarrison: tower ${towerId} not registered`);
        }

        const role = getGarrisonRole(unit.subType as UnitType);
        if (!role) {
            throw new Error(
                `TowerGarrisonManager.finalizeGarrison: unit ${unitId} has no garrison role (subType=${unit.subType})`
            );
        }

        const slots = role === 'swordsman' ? garrison.swordsmanSlots : garrison.bowmanSlots;
        slots.unitIds.push(unitId);
        this.locationManager.enterBuilding(unitId, towerId);

        this.eventBus.emit('garrison:unitEntered', { buildingId: towerId, unitId });
        log.debug(`Unit ${unitId} garrisoned in tower ${towerId} (${role} slot)`);
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

        const tower = this.gameState.getEntityOrThrow(towerId, 'TowerGarrisonManager.ejectUnit');

        const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonManager.ejectUnit');
        this.unitReservation.release(unitId);
        this.locationManager.exitBuilding(unitId);
        this.placeAtApproach(unit, tower);

        this.eventBus.emit('garrison:unitExited', { buildingId: towerId, unitId });
        log.debug(`Unit ${unitId} ejected from tower ${towerId}`);
    }

    // =========================================================================
    // Persistable
    // =========================================================================

    serialize(): SerializedTowerGarrison {
        const garrisons: SerializedTowerGarrison['garrisons'] = [];
        for (const [, state] of sortedEntries(this.garrisons)) {
            garrisons.push({
                buildingId: state.buildingId,
                swordsmanUnitIds: [...state.swordsmanSlots.unitIds],
                bowmanUnitIds: [...state.bowmanSlots.unitIds],
            });
        }

        return { garrisons };
    }

    deserialize(data: SerializedTowerGarrison): void {
        this.garrisons.clear();
        for (const entry of data.garrisons) {
            const tower = this.gameState.getEntityOrThrow(entry.buildingId, 'TowerGarrisonManager.deserialize');
            const capacity = getGarrisonCapacity(tower.subType as BuildingType);
            if (!capacity) {
                throw new Error(
                    `TowerGarrisonManager.deserialize: building ${entry.buildingId} has no garrison capacity`
                );
            }

            this.garrisons.set(entry.buildingId, {
                buildingId: entry.buildingId,
                swordsmanSlots: { max: capacity.swordsmanSlots, unitIds: [...entry.swordsmanUnitIds] },
                bowmanSlots: { max: capacity.bowmanSlots, unitIds: [...entry.bowmanUnitIds] },
            });

            // Garrisoned units keep their reservation (they must not be player-moved).
            // Restore onForcedRelease so killed-while-garrisoned still cleans up the slot.
            const buildingId = entry.buildingId;
            for (const unitId of [...entry.swordsmanUnitIds, ...entry.bowmanUnitIds]) {
                this.unitReservation.reserve(unitId, {
                    purpose: 'garrison',
                    onForcedRelease: id => {
                        const garrison = this.garrisons.get(buildingId);
                        if (!garrison) return;
                        removeFromArray(garrison.swordsmanSlots.unitIds, id);
                        removeFromArray(garrison.bowmanSlots.unitIds, id);
                    },
                });
            }
        }

        // En-route units are restored by SettlerBuildingLocationManager (it persists approaching state).
        // Move tasks are NOT re-issued here — the feature does that in onTerrainReady, after pathfinding
        // is available. Reservations for en-route units are restored there too (via markEnRoute).

        log.debug(`Deserialized: ${this.garrisons.size} towers`);
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
    getApproachTile(building: Entity): { x: number; y: number } {
        if (!this.terrain) {
            log.warn(`getApproachTile: terrain not set for building ${building.id} — falling back to door pos`);
            return getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
        }
        return findBuildingApproachTile(building, this.terrain, this.gameState);
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private releaseGarrisonedUnit(unitId: number, tower: Entity): void {
        const unit = this.gameState.getEntity(unitId);
        if (!unit) return; // May have been removed externally already

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
    if (index === -1) return false;
    arr.splice(index, 1);
    return true;
}

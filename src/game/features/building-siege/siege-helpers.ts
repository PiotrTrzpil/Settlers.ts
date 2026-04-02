/**
 * Siege helper functions — pure queries for building sieges.
 *
 * Extracted from building-siege-system.ts to keep it under the line limit.
 */

import type { GameState } from '../../game-state';
import type { CombatSystem } from '../combat/combat-system';
import { EntityType, UnitType, BuildingType, type Entity, type Tile, EXTENDED_OFFSETS, tileKey } from '../../entity';
import type { Race } from '../../core/race';
import { getBaseUnitType } from '../../core/unit-types';
import { CombatStatus } from '../combat/combat-state';
import { isGarrisonBuildingType } from '../tower-garrison';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { DOOR_ARRIVAL_DISTANCE } from './siege-types';

/** Returns walkable tiles adjacent to the building's door (not inside building footprint). */
export function findDoorAdjacentTiles(
    building: { x: number; y: number; race: Race; subType: number | string },
    gameState: GameState
): Tile[] {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
    const tiles: Tile[] = [];
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const x = door.x + dx;
        const y = door.y + dy;
        if (!gameState.buildingOccupancy.has(tileKey(x, y))) {
            tiles.push({ x, y });
        }
    }
    return tiles;
}

/** Returns true if the given UnitType is a swordsman (any level). */
export function isSwordsman(unitType: UnitType): boolean {
    return getBaseUnitType(unitType) === UnitType.Swordsman1;
}

/** Find the closest enemy garrison building (by door distance) within the given radius. */
export function findNearbyEnemyGarrison(
    unit: { x: number; y: number; player: number },
    radius: number,
    gameState: GameState
): Entity | undefined {
    const nearby = gameState.getEntitiesInRadius(unit.x, unit.y, radius);
    let best: Entity | undefined;
    let bestDist = Infinity;

    for (const candidate of nearby) {
        if (candidate.type !== EntityType.Building) {
            continue;
        }
        if (candidate.player === unit.player) {
            continue;
        }
        if (!isGarrisonBuildingType(candidate.subType as BuildingType)) {
            continue;
        }

        // Measure distance to the door, not the building center
        const door = getBuildingDoorPos(candidate.x, candidate.y, candidate.race, candidate.subType as BuildingType);
        const dx = door.x - unit.x;
        const dy = door.y - unit.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            best = candidate;
        }
    }
    return best;
}

/**
 * Find any enemy swordsman near a building's door that is not reserved
 * and not hidden. Used to find a unit to dispatch for capture.
 */
export function findSwordsmanAtDoor(
    building: { x: number; y: number; race: Race; subType: number | string; player: number },
    gameState: GameState,
    isReserved: (id: number) => boolean
): Entity | undefined {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
    const nearby = gameState.getEntitiesInRadius(door.x, door.y, DOOR_ARRIVAL_DISTANCE);
    for (const unit of nearby) {
        if (unit.type !== EntityType.Unit || unit.hidden) {
            continue;
        }
        if (unit.player === building.player) {
            continue;
        }
        if (!isSwordsman(unit.subType as UnitType)) {
            continue;
        }
        if (isReserved(unit.id)) {
            continue;
        }
        return unit;
    }
    return undefined;
}

/** Check if any enemy swordsman is within door arrival distance of the building. */
export function hasEnemyAtDoor(
    building: { x: number; y: number; race: Race; subType: number | string; player: number },
    gameState: GameState
): boolean {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
    const nearby = gameState.getEntitiesInRadius(door.x, door.y, DOOR_ARRIVAL_DISTANCE);
    for (const unit of nearby) {
        if (unit.type !== EntityType.Unit || unit.hidden) {
            continue;
        }
        if (unit.player === building.player) {
            continue;
        }
        if (!isSwordsman(unit.subType as UnitType)) {
            continue;
        }
        return true;
    }
    return false;
}

/**
 * Find all enemy unit IDs currently in melee combat with the given defender.
 * Used by the siege system to enforce the door attacker limit.
 */
export function findUnitsAttacking(defenderId: number, gameState: GameState, combatSystem: CombatSystem): number[] {
    const result: number[] = [];
    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Unit || entity.hidden) {
            continue;
        }
        const state = combatSystem.getState(entity.id);
        if (state && state.targetId === defenderId && state.status === CombatStatus.Fighting) {
            result.push(entity.id);
        }
    }
    return result;
}

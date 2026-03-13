/**
 * Siege helper functions — pure queries and scan logic for building sieges.
 *
 * Extracted from building-siege-system.ts to keep it under the line limit.
 */

import type { GameState } from '../../game-state';
import { EntityType, UnitType, BuildingType, type Entity } from '../../entity';
import type { Race } from '../../core/race';
import { getBaseUnitType } from '../../core/unit-types';
import { isGarrisonBuildingType } from '../tower-garrison/internal/garrison-capacity';
import { getBuildingDoorPos } from '../../data/game-data-access';
import type { SiegeState } from './siege-types';
import { DOOR_ARRIVAL_DISTANCE } from './siege-types';

/** Returns true if the given UnitType is a swordsman (any level). */
export function isSwordsman(unitType: UnitType): boolean {
    return getBaseUnitType(unitType) === UnitType.Swordsman1;
}

/** Returns true if the unit is already part of any active siege. */
export function isInAnySiege(unitId: number, sieges: ReadonlyMap<number, SiegeState>): boolean {
    for (const siege of sieges.values()) {
        if (siege.attackerIds.includes(unitId)) {
            return true;
        }
    }
    return false;
}

/** Check if any attacker is within door arrival distance of the building. */
export function hasAttackerAtDoor(
    siege: SiegeState,
    building: { x: number; y: number; race: Race; subType: number },
    gameState: GameState
): boolean {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);

    for (const attackerId of siege.attackerIds) {
        const attacker = gameState.getEntity(attackerId);
        if (!attacker) {
            continue;
        }
        const dist = Math.max(Math.abs(attacker.x - door.x), Math.abs(attacker.y - door.y));
        if (dist <= DOOR_ARRIVAL_DISTANCE) {
            return true;
        }
    }
    return false;
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

/** Check if a unit is an idle enemy swordsman suitable for auto-siege. */
export function isIdleEnemySwordsman(
    unit: Entity,
    buildingPlayer: number,
    isInCombat: (id: number) => boolean,
    sieges: ReadonlyMap<number, SiegeState>,
    isReserved: (id: number) => boolean
): boolean {
    return (
        unit.type === EntityType.Unit &&
        unit.player !== buildingPlayer &&
        isSwordsman(unit.subType as UnitType) &&
        !isInCombat(unit.id) &&
        !isInAnySiege(unit.id, sieges) &&
        !isReserved(unit.id)
    );
}

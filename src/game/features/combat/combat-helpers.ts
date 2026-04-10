/**
 * Combat helper functions — pure queries extracted from combat-system.ts.
 */

import { tileKey, Tile, EntityType, isUnitTypeMilitary, UnitType, type Entity } from '../../entity';
import { bfsFind } from '../../core/tile-search';
import type { GameState } from '../../game-state';
import type { CombatState } from './combat-state';
import { findNearestByHexDistance } from '../../systems/hex-directions';

/**
 * If (x,y) is inside a building footprint, BFS outward to find the nearest
 * tile outside. Searches up to 2 rings (18 tiles) to handle large buildings.
 */
export function resolveOutsideBuilding(tile: Tile, buildingOccupancy: ReadonlySet<string>): Tile {
    if (!buildingOccupancy.has(tileKey(tile))) {
        return tile;
    }
    // BFS outward to find nearest tile outside any building footprint (max ~54 tiles = 3 rings)
    return bfsFind(tile, t => !buildingOccupancy.has(tileKey(t)), 54) ?? tile;
}

/** Detection range: how far a unit scans for enemies (in hex tiles). */
export const DETECTION_RANGE = 17;

/** Melee fight range: hex distance at which a unit can melee attack (1 = adjacent). */
export const FIGHT_RANGE = 1;

/** Distance threshold: ranged units shoot when enemy is farther than this, melee when closer. */
export const RANGED_MELEE_THRESHOLD = 2;

/** Maximum range at which ranged units can shoot. */
export const SHOOT_RANGE = 8;

/**
 * Returns true if there are visible, non-reserved, non-locked enemy military
 * units near the given entity. Used by the siege system to defer siege start
 * while field enemies are present.
 */
export function hasNearbyThreats(entity: Entity, gameState: GameState, isExcluded: (id: number) => boolean): boolean {
    const nearby = gameState.getEntitiesInRadius(entity, DETECTION_RANGE);
    for (const candidate of nearby) {
        if (candidate.type !== EntityType.Unit || candidate.hidden) {
            continue;
        }
        if (candidate.player === entity.player) {
            continue;
        }
        if (!isUnitTypeMilitary(candidate.subType as UnitType)) {
            continue;
        }
        if (isExcluded(candidate.id)) {
            continue;
        }
        return true;
    }
    return false;
}

/**
 * Find the nearest enemy entity to `entity`. Prefers military targets over
 * specialists. Only considers visible, alive units with combat state.
 */
export function findNearestEnemy(
    entity: Entity,
    gameState: GameState,
    combatStates: ReadonlyMap<number, CombatState>
): Entity | null {
    const nearby = gameState.getEntitiesInRadius(entity, DETECTION_RANGE);
    const militaryTargets: Entity[] = [];
    const specialistTargets: Entity[] = [];

    for (const c of nearby) {
        if (c.type !== EntityType.Unit || c.hidden || c.player === entity.player) {
            continue;
        }
        const state = combatStates.get(c.id);
        if (!state || state.health <= 0) {
            continue;
        }
        if (isUnitTypeMilitary(c.subType as UnitType)) {
            militaryTargets.push(c);
        } else {
            specialistTargets.push(c);
        }
    }

    const targets = militaryTargets.length > 0 ? militaryTargets : specialistTargets;
    return findNearestByHexDistance(entity, targets);
}

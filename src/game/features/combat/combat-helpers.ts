/**
 * Combat helper functions — pure queries extracted from combat-system.ts.
 */

import { tileKey, EXTENDED_OFFSETS, Tile, EntityType, isUnitTypeMilitary, UnitType, type Entity } from '../../entity';
import type { GameState } from '../../game-state';
import type { CombatState } from './combat-state';
import { findNearestByHexDistance } from '../../systems/hex-directions';

/**
 * If (x,y) is inside a building footprint, BFS outward to find the nearest
 * tile outside. Searches up to 2 rings (18 tiles) to handle large buildings.
 */
export function resolveOutsideBuilding(x: number, y: number, buildingOccupancy: ReadonlySet<string>): Tile {
    if (!buildingOccupancy.has(tileKey(x, y))) {
        return { x, y };
    }
    // BFS using EXTENDED_OFFSETS from each frontier tile
    const visited = new Set<string>();
    visited.add(tileKey(x, y));
    let frontier: Array<Tile> = [{ x, y }];

    for (let ring = 0; ring < 3; ring++) {
        const nextFrontier: Array<Tile> = [];
        for (const pos of frontier) {
            for (const [dx, dy] of EXTENDED_OFFSETS) {
                const nx = pos.x + dx;
                const ny = pos.y + dy;
                const key = tileKey(nx, ny);
                if (visited.has(key)) {
                    continue;
                }
                visited.add(key);
                if (!buildingOccupancy.has(key)) {
                    return { x: nx, y: ny };
                }
                nextFrontier.push({ x: nx, y: ny });
            }
        }
        frontier = nextFrontier;
    }
    return { x, y };
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
    const nearby = gameState.getEntitiesInRadius(entity.x, entity.y, DETECTION_RANGE);
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
    const nearby = gameState.getEntitiesInRadius(entity.x, entity.y, DETECTION_RANGE);
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

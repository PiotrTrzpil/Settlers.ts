/**
 * AI World Queries — pure read-only helpers for querying game state.
 *
 * All functions take GameState + GameServices parameters and return data.
 * No side effects, no commands issued.
 */

import { EntityType, BuildingType, isUnitTypeMilitary, type UnitType } from '@/game/entity';
import type { Entity } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { GameServices } from '@/game/game-services';
import { TERRITORY_BUILDINGS } from '@/game/features/territory';

// ── Building queries ─────────────────────────────────────────────────────────

/**
 * Get all buildings owned by a player, optionally filtered by building type.
 * Returns an array of entities (deterministic order via sorted IDs).
 */
export function getPlayerBuildings(state: GameState, player: number, buildingType?: BuildingType): readonly Entity[] {
    const ids = state.entityIndex.idsOfTypeAndPlayer(EntityType.Building, player);
    const result: Entity[] = [];
    // Sort IDs for deterministic iteration
    const sorted = [...ids].sort((a, b) => a - b);
    for (const id of sorted) {
        const entity = state.getEntityOrThrow(id, 'getPlayerBuildings');
        if (buildingType === undefined || entity.subType === buildingType) {
            result.push(entity);
        }
    }
    return result;
}

/**
 * Count operational buildings (finished construction) of a given type for a player.
 * A building is operational when it has NO active construction site.
 */
export function countOperationalBuildings(
    state: GameState,
    services: GameServices,
    player: number,
    buildingType: BuildingType
): number {
    const buildings = getPlayerBuildings(state, player, buildingType);
    let count = 0;
    for (const building of buildings) {
        if (!services.constructionSiteManager.hasSite(building.id)) {
            count++;
        }
    }
    return count;
}

// ── Unit queries ─────────────────────────────────────────────────────────────

/**
 * Get all military units owned by a player.
 * Returns entities sorted by ID for deterministic iteration.
 */
export function getPlayerMilitaryUnits(state: GameState, player: number): readonly Entity[] {
    const ids = state.entityIndex.idsOfTypeAndPlayer(EntityType.Unit, player);
    const result: Entity[] = [];
    const sorted = [...ids].sort((a, b) => a - b);
    for (const id of sorted) {
        const entity = state.getEntityOrThrow(id, 'getPlayerMilitaryUnits');
        if (isUnitTypeMilitary(entity.subType as UnitType)) {
            result.push(entity);
        }
    }
    return result;
}

// ── Base queries ────────────────────────────────────────────────────────────

/**
 * Get the position of a player's main base — the highest-priority territory
 * building (Castle > GuardTowerBig > GuardTowerSmall).
 * Throws if the player has no territory buildings.
 */
export function getPlayerBasePosition(state: GameState, player: number): { x: number; y: number } {
    const buildings = getPlayerBuildings(state, player);
    let best: Entity | null = null;
    let bestPriority = -1;
    for (const b of buildings) {
        const bt = b.subType as BuildingType;
        if (!TERRITORY_BUILDINGS.has(bt)) {
            continue;
        }
        let priority = 0;
        if (bt === BuildingType.Castle) {
            priority = 2;
        } else if (bt === BuildingType.GuardTowerBig) {
            priority = 1;
        }
        if (priority > bestPriority) {
            bestPriority = priority;
            best = b;
        }
    }
    if (!best) {
        throw new Error(`getPlayerBasePosition: player ${player} has no territory buildings`);
    }
    return { x: best.x, y: best.y };
}

/**
 * Find the nearest enemy territory building to a given position.
 * Returns the position and owning player, or null if no enemy bases exist.
 */
export function findNearestEnemyBase(
    state: GameState,
    player: number,
    fromX: number,
    fromY: number
): { x: number; y: number; player: number } | null {
    let bestDist = Infinity;
    let bestResult: { x: number; y: number; player: number } | null = null;

    const allBuildingIds = state.entityIndex.idsOfType(EntityType.Building);
    const sorted = [...allBuildingIds].sort((a, b) => a - b);
    for (const id of sorted) {
        const entity = state.getEntityOrThrow(id, 'building in findNearestEnemyBase');
        if (entity.player === player) {
            continue;
        }
        if (!TERRITORY_BUILDINGS.has(entity.subType as BuildingType)) {
            continue;
        }

        const dx = entity.x - fromX;
        const dy = entity.y - fromY;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            bestResult = { x: entity.x, y: entity.y, player: entity.player };
        }
    }
    return bestResult;
}

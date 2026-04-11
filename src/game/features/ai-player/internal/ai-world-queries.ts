/**
 * AI World Queries — pure read-only helpers for querying game state.
 *
 * All functions take GameState + GameServices parameters and return data.
 * No side effects, no commands issued.
 */

import { EntityType, BuildingType, isUnitTypeMilitary, type UnitType, Tile } from '@/game/entity';
import type { Entity } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { GameServices } from '@/game/game-services';
import { TERRITORY_BUILDINGS } from '@/game/features/territory';

export type TileWithPlayer = Tile & { player: number };

// ── Building queries ─────────────────────────────────────────────────────────

/**
 * Get all buildings owned by a player, optionally filtered by building type.
 * Returns an array of entities (deterministic order via sorted IDs).
 */
export function getPlayerBuildings(state: GameState, player: number, buildingType?: BuildingType): readonly Entity[] {
    const q =
        buildingType !== undefined
            ? state.entityIndex.query(EntityType.Building, player, buildingType)
            : state.entityIndex.query(EntityType.Building, player);
    return q.toArray().sort((a, b) => a.id - b.id);
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
    return state.entityIndex
        .query(EntityType.Building, player, buildingType)
        .filter(b => !services.constructionSiteManager.hasSite(b.id))
        .count();
}

// ── Unit queries ─────────────────────────────────────────────────────────────

/**
 * Get all military units owned by a player.
 * Returns entities sorted by ID for deterministic iteration.
 */
export function getPlayerMilitaryUnits(state: GameState, player: number): readonly Entity[] {
    return state.entityIndex
        .query(EntityType.Unit, player)
        .filter(e => isUnitTypeMilitary(e.subType as UnitType))
        .toArray()
        .sort((a, b) => a.id - b.id);
}

// ── Base queries ────────────────────────────────────────────────────────────

/**
 * Get the position of a player's main base — the highest-priority territory
 * building (Castle > GuardTowerBig > GuardTowerSmall).
 * Throws if the player has no territory buildings.
 */
export function getPlayerBasePosition(state: GameState, player: number): Tile {
    let best: Entity | null = null;
    let bestPriority = -1;
    for (const b of state.entityIndex
        .query(EntityType.Building, player)
        .filter(e => TERRITORY_BUILDINGS.has(e.subType as BuildingType))) {
        const bt = b.subType as BuildingType;
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
): TileWithPlayer | null {
    const nearest = state.entityIndex
        .query(EntityType.Building)
        .filter(e => e.player !== player && TERRITORY_BUILDINGS.has(e.subType as BuildingType))
        .nearest({ x: fromX, y: fromY });
    if (!nearest) {
        return null;
    }
    return { x: nearest.x, y: nearest.y, player: nearest.player };
}

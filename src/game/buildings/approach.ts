/**
 * Building approach tile resolution.
 *
 * Finds the best walkable tile for a unit to stand on when interacting with
 * a building (garrisoning, attacking, occupying, delivering, etc.).
 *
 * A valid approach tile is:
 *   - In bounds
 *   - Terrain-passable
 *   - Not inside any building's footprint (buildingOccupancy)
 *
 * Unit occupancy is NOT checked — units are transient obstacles resolved
 * at movement time via bump-or-wait. Checking unit occupancy here causes
 * approach tiles to shift away from the door in congested areas, preventing
 * units from ever reaching the building entrance.
 */

import type { Entity } from '@/game/entity';
import { EXTENDED_OFFSETS, tileKey } from '@/game/entity';
import type { TerrainData } from '@/game/terrain';
import type { GameState } from '@/game/game-state';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { BuildingType } from './building-type';

/**
 * Find the best tile from which a unit can approach a building.
 *
 * Checks the door tile first, then searches EXTENDED_OFFSETS order.
 * Returns the door position unchanged if no walkable tile is found
 * (e.g., the area is entirely building footprint or impassable terrain).
 */
export function findBuildingApproachTile(
    building: Entity,
    terrain: TerrainData,
    gameState: GameState
): { x: number; y: number } {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
    return findApproachTileNear(door.x, door.y, terrain, gameState) ?? door;
}

/**
 * Find the nearest walkable tile at or around (x, y).
 * Returns null if no suitable tile is found within the search radius.
 */
export function findApproachTileNear(
    x: number,
    y: number,
    terrain: TerrainData,
    gameState: GameState
): { x: number; y: number } | null {
    if (isWalkable(x, y, terrain, gameState)) return { x, y };

    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isWalkable(nx, ny, terrain, gameState)) return { x: nx, y: ny };
    }

    return null;
}

function isWalkable(x: number, y: number, terrain: TerrainData, gameState: GameState): boolean {
    return terrain.isInBounds(x, y) && terrain.isPassable(x, y) && !gameState.buildingOccupancy.has(tileKey(x, y));
}

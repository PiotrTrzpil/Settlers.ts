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
 *   - Adjacent to the door (never the door tile itself)
 *
 * Unit occupancy is NOT checked — units are transient obstacles resolved
 * at movement time via bump-or-wait. Checking unit occupancy here causes
 * approach tiles to shift away from the door in congested areas, preventing
 * units from ever reaching the building entrance.
 */

import type { Entity, Tile } from '@/game/entity';
import { EXTENDED_OFFSETS, tileKey } from '@/game/entity';
import type { TerrainData } from '@/game/terrain';
import type { GameState } from '@/game/game-state';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { BuildingType } from './building-type';

/**
 * Find the best walkable tile adjacent to a building's door.
 * Never returns the door tile itself — always an adjacent neighbor.
 * Falls back to the door position only if all adjacent tiles are blocked.
 */
export function findBuildingApproachTile(building: Entity, terrain: TerrainData, gameState: GameState): Tile {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
    return findAdjacentWalkableTile(door.x, door.y, terrain, gameState) ?? door;
}

/**
 * Find the nearest walkable tile adjacent to (x, y) — never returns (x, y) itself.
 * Searches EXTENDED_OFFSETS (6 hex neighbors) in order.
 * Returns null if no adjacent tile is walkable.
 */
export function findAdjacentWalkableTile(
    x: number,
    y: number,
    terrain: TerrainData,
    gameState: GameState
): Tile | null {
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isWalkable(nx, ny, terrain, gameState)) {
            return { x: nx, y: ny };
        }
    }

    return null;
}

function isWalkable(x: number, y: number, terrain: TerrainData, gameState: GameState): boolean {
    return terrain.isInBounds(x, y) && terrain.isPassable(x, y) && !gameState.buildingOccupancy.has(tileKey(x, y));
}

/**
 * Walkable approach tiles — where a unit stands when interacting with a
 * building, map object, or other blocked tile.
 *
 * A valid approach tile is:
 *   - Not inside buildingOccupancy (path-blocking tiles)
 *   - Optionally in-bounds and terrain-passable (when terrain is provided)
 *
 * Unit occupancy is NOT checked — units are transient, resolved at movement
 * time via bump-or-wait. Checking occupancy here shifts approach tiles away
 * from doors in crowds, so units never reach the entrance.
 */

import type { Entity, Tile } from '@/game/entity';
import { EXTENDED_OFFSETS, tileKey } from '@/game/core/coordinates';
import type { TerrainData } from '@/game/terrain';
import type { GameState } from '@/game/game-state';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { BuildingType } from './building-type';
import { bfsFind } from '@/game/core/tile-search';
import { GRID_DELTAS, NUMBER_OF_DIRECTIONS, getDirectionToward } from '@/game/systems/hex-directions';

function isWalkable(tile: Tile, occupancy: ReadonlySet<string>, terrain?: TerrainData): boolean {
    if (occupancy.has(tileKey(tile))) {
        return false;
    }
    if (!terrain) {
        return true;
    }
    return terrain.isInBounds(tile) && terrain.isPassable(tile);
}

/**
 * Nearest walkable neighbor of `tile` — never returns `tile` itself.
 *
 * When `from` is set, tries the side facing that tile first, then rotates.
 * Otherwise uses EXTENDED_OFFSETS order (building-door approach).
 */
export function findAdjacentWalkableTile(
    tile: Tile,
    occupancy: ReadonlySet<string>,
    from?: Tile,
    terrain?: TerrainData
): Tile | null {
    if (from) {
        const startDir = getDirectionToward(tile.x, tile.y, from.x, from.y);
        for (let offset = 0; offset < NUMBER_OF_DIRECTIONS; offset++) {
            const dir = (startDir + offset) % NUMBER_OF_DIRECTIONS;
            const [dx, dy] = GRID_DELTAS[dir]!;
            const neighbor: Tile = { x: tile.x + dx, y: tile.y + dy };
            if (isWalkable(neighbor, occupancy, terrain)) {
                return neighbor;
            }
        }
        return null;
    }

    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const neighbor: Tile = { x: tile.x + dx, y: tile.y + dy };
        if (isWalkable(neighbor, occupancy, terrain)) {
            return neighbor;
        }
    }
    return null;
}

/**
 * Walkable tile adjacent to a building's door. Falls back to the door itself
 * if every neighbor is blocked.
 */
export function findBuildingApproachTile(building: Entity, terrain: TerrainData, gameState: GameState): Tile {
    const door = getBuildingDoorPos(building, building.race, building.subType as BuildingType);
    return findAdjacentWalkableTile(door, gameState.buildingOccupancy, undefined, terrain) ?? door;
}

/**
 * If `tile` is inside a building footprint, BFS outward to the nearest
 * unblocked tile (up to 3 hex rings). Otherwise returns `tile`.
 */
export function resolveOutsideBuilding(tile: Tile, buildingOccupancy: ReadonlySet<string>): Tile {
    if (!buildingOccupancy.has(tileKey(tile))) {
        return tile;
    }
    return bfsFind(tile, t => !buildingOccupancy.has(tileKey(t)), 54) ?? tile;
}

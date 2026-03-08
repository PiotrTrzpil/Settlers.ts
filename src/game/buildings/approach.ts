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
 *   - Not currently occupied by another entity
 */

import type { Entity } from '@/game/entity';
import { EXTENDED_OFFSETS, tileKey } from '@/game/entity';
import type { TerrainData } from '@/game/terrain';
import type { GameState } from '@/game/game-state';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { createLogger } from '@/utilities/logger';
import { BuildingType } from './building-type';

const log = createLogger('approach');

/**
 * Find the best tile from which a unit can approach a building.
 *
 * Checks the door tile first, then searches EXTENDED_OFFSETS order.
 * Returns the door position unchanged if no free walkable tile is found
 * (e.g., the area is completely surrounded — pathfinding will handle it).
 */
export function findBuildingApproachTile(
    building: Entity,
    terrain: TerrainData,
    gameState: GameState
): { x: number; y: number } {
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
    const result = findApproachTileNear(door.x, door.y, terrain, gameState);
    if (!result) {
        log.warn(
            `No free walkable tile near door (${door.x},${door.y}) for building ${building.id} — falling back to door.` +
                ` door.inBuilding=${gameState.buildingOccupancy.has(tileKey(door.x, door.y))}` +
                ` door.passable=${terrain.isPassable(door.x, door.y)}`
        );
    }
    log.debug(
        `approach: door=(${door.x},${door.y}) result=(${result?.x ?? door.x},${result?.y ?? door.y})` +
            ` inBuilding=${gameState.buildingOccupancy.has(tileKey(result?.x ?? door.x, result?.y ?? door.y))}`
    );
    return result ?? door;
}

/**
 * Find the nearest free walkable tile at or around (x, y).
 * Returns null if no suitable tile is found within the search radius.
 */
export function findApproachTileNear(
    x: number,
    y: number,
    terrain: TerrainData,
    gameState: GameState
): { x: number; y: number } | null {
    if (isFreeWalkable(x, y, terrain, gameState)) return { x, y };
    log.debug(
        `  (${x},${y}): inBounds=${terrain.isInBounds(x, y)} passable=${terrain.isPassable(x, y)} inBuilding=${gameState.buildingOccupancy.has(tileKey(x, y))} occupied=${!!gameState.getEntityAt(x, y)}`
    );

    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isFreeWalkable(nx, ny, terrain, gameState)) return { x: nx, y: ny };
        log.debug(
            `  (${nx},${ny}): inBounds=${terrain.isInBounds(nx, ny)} passable=${terrain.isPassable(nx, ny)} inBuilding=${gameState.buildingOccupancy.has(tileKey(nx, ny))} occupied=${!!gameState.getEntityAt(nx, ny)}`
        );
    }

    return null;
}

function isFreeWalkable(x: number, y: number, terrain: TerrainData, gameState: GameState): boolean {
    return (
        terrain.isInBounds(x, y) &&
        terrain.isPassable(x, y) &&
        !gameState.buildingOccupancy.has(tileKey(x, y)) &&
        !gameState.getEntityAt(x, y)
    );
}

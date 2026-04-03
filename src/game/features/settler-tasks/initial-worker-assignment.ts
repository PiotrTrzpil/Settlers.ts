/**
 * Post-map-load unit relocation.
 *
 * Map data places units at building anchors, which are deep inside the blocked
 * footprint. This module moves them to free tiles near the door so they can
 * pathfind normally. Worker-to-building assignment happens separately via the
 * normal tick systems.
 */

import { BuildingType, EntityType, Tile, tileKey } from '../../entity';
import type { GameState } from '../../game-state';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { bfsFind } from '@/game/core/tile-search';
import { createLogger } from '@/utilities/logger';

const log = createLogger('InitialWorkerAssignment');

/**
 * Relocate any unit sitting on a building footprint to a free tile near the
 * building's door. Each unit gets a unique tile to avoid stacking.
 */
export function relocateUnitsFromFootprints(gameState: GameState): void {
    const taken = new Set<string>();
    let relocated = 0;

    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Unit) {
            continue;
        }
        const buildingAtTile = gameState.getGroundEntityAt(entity.x, entity.y);
        if (!buildingAtTile || buildingAtTile.type !== EntityType.Building) {
            continue;
        }
        const door = getBuildingDoorPos(
            buildingAtTile.x,
            buildingAtTile.y,
            buildingAtTile.race,
            buildingAtTile.subType as BuildingType
        );

        const target = findFreeTileNear(door.x, door.y, taken, gameState);
        entity.x = target.x;
        entity.y = target.y;
        taken.add(tileKey(target.x, target.y));
        relocated++;
    }
    if (relocated > 0) {
        log.debug(`Relocated ${relocated} units from building footprints`);
    }
}

/** Find the nearest non-building, non-taken tile using BFS outward from the door. */
function findFreeTileNear(doorX: number, doorY: number, taken: Set<string>, gameState: GameState): Tile {
    return (
        bfsFind(doorX, doorY, (x, y) => !taken.has(tileKey(x, y)) && !gameState.getGroundEntityAt(x, y), 100) ?? {
            x: doorX,
            y: doorY,
        }
    );
}

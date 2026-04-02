/**
 * Post-map-load unit relocation.
 *
 * Map data places units at building anchors, which are deep inside the blocked
 * footprint. This module moves them to free tiles near the door so they can
 * pathfind normally. Worker-to-building assignment happens separately via the
 * normal tick systems.
 */

import { BuildingType, EntityType, Tile } from '../../entity';
import type { GameState } from '../../game-state';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { GRID_DELTAS, NUMBER_OF_DIRECTIONS } from '../../systems/hex-directions';
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
        taken.add(`${target.x},${target.y}`);
        relocated++;
    }
    if (relocated > 0) {
        log.debug(`Relocated ${relocated} units from building footprints`);
    }
}

/** Find the nearest non-building, non-taken tile using BFS outward from the door. */
function findFreeTileNear(doorX: number, doorY: number, taken: Set<string>, gameState: GameState): Tile {
    const visited = new Set<string>();
    const queue: Tile[] = [{ x: doorX, y: doorY }];
    visited.add(`${doorX},${doorY}`);

    while (queue.length > 0) {
        const { x, y } = queue.shift()!;
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            const [dx, dy] = GRID_DELTAS[d]!;
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            if (!taken.has(key) && !gameState.getGroundEntityAt(nx, ny)) {
                return { x: nx, y: ny };
            }
            // Keep expanding through building tiles to find the edge
            if (visited.size < 100) {
                queue.push({ x: nx, y: ny });
            }
        }
    }

    return { x: doorX, y: doorY };
}

/**
 * Work handler factory for geologist prospecting (RESOURCE_POS search type).
 */

import type { TerrainData } from '../../terrain';
import type { OreVeinData } from './ore-vein-data';
import type { ResourceSignSystem } from './resource-sign-system';
import type { PositionWorkHandler } from '../settler-tasks/types';
import { createActivatedPositionHandler } from '../settler-tasks/activated-position-handler';

const GEOLOGIST_SEARCH_RADIUS = 20;

/** Max Chebyshev distance from the move target to a rock tile for activation. */
const MOUNTAIN_PROXIMITY = 5;

/** Check if there is any rock tile within MOUNTAIN_PROXIMITY of (x, y). */
function isNearMountain(x: number, y: number, terrain: TerrainData): boolean {
    const x0 = Math.max(0, x - MOUNTAIN_PROXIMITY);
    const x1 = Math.min(terrain.width - 1, x + MOUNTAIN_PROXIMITY);
    const y0 = Math.max(0, y - MOUNTAIN_PROXIMITY);
    const y1 = Math.min(terrain.height - 1, y + MOUNTAIN_PROXIMITY);
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (terrain.isRock(tx, ty)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Create a position handler for RESOURCE_POS search type (geologists).
 * Worker walks to an unprospected rock tile, performs work animation,
 * then marks the tile as prospected and places a resource sign.
 *
 * Tile selection uses a two-phase search:
 * 1. Local phase — scan a small area around the geologist's current position,
 *    pick the candidate closest to the origin. This produces a natural ring sweep.
 * 2. Fallback phase — spiral from origin to find the nearest remaining tile
 *    (jumps to the next ring when the local area is exhausted).
 */
export function createGeologistHandler(
    oreVeinData: OreVeinData,
    terrain: TerrainData,
    signSystem: ResourceSignSystem
): PositionWorkHandler {
    return createActivatedPositionHandler({
        mapWidth: terrain.width,
        mapHeight: terrain.height,
        searchRadius: GEOLOGIST_SEARCH_RADIUS,
        tilePredicate: (tx, ty) => terrain.isRock(tx, ty) && !oreVeinData.isProspected(tx, ty),
        onWorkComplete: (posX, posY) => {
            oreVeinData.setProspected(posX, posY);
            signSystem.placeSign(posX, posY);
        },
        shouldActivate: (targetX, targetY) => isNearMountain(targetX, targetY, terrain),
    });
}

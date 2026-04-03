/**
 * Work handler factory for geologist prospecting (RESOURCE_POS search type).
 */

import type { TerrainData } from '../../terrain';
import type { OreVeinData } from './ore-vein-data';
import type { ResourceSignSystem } from './resource-sign-system';
import type { PositionWorkHandler } from '../settler-tasks/types';
import { createActivatedPositionHandler } from '../settler-tasks/activated-position-handler';
import { scanRect } from '../../core/tile-search';

const GEOLOGIST_SEARCH_RADIUS = 20;

/** Max Chebyshev distance from the move target to a rock tile for activation. */
const MOUNTAIN_PROXIMITY = 5;

/** Check if there is any rock tile within MOUNTAIN_PROXIMITY of (x, y). */
function isNearMountain(x: number, y: number, terrain: TerrainData): boolean {
    return scanRect(x, y, MOUNTAIN_PROXIMITY, terrain.width, terrain.height, (tx, ty) => terrain.isRock(tx, ty));
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

/**
 * Resource placement validation.
 * Validates single-tile resource placement.
 */

import type { Tile } from '../../../core/coordinates';
import type { TerrainData } from '../../../terrain';
import type { PlacementContext, PlacementResult } from '../types';
import { validateSingleTilePlacement, canPlaceSingleTile } from './single-tile-validator';

/**
 * Validate resource placement with detailed status.
 * Resources have simpler rules than buildings:
 * - Must be within bounds
 * - Must be on passable terrain
 * - Must not be occupied
 *
 * @param tile Tile coordinates
 * @param ctx Game context for validation
 * @returns Placement result with canPlace and detailed status
 */
export function validateResourcePlacement(tile: Tile, ctx: PlacementContext): PlacementResult {
    return validateSingleTilePlacement(tile, ctx);
}

/**
 * Simple boolean check for resource placement.
 * Use validateResourcePlacement for detailed status.
 */
export function canPlaceResource(
    terrain: TerrainData,
    groundOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    return canPlaceSingleTile(terrain, groundOccupancy, x, y);
}

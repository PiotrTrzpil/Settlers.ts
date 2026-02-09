/**
 * Resource placement validation.
 * Validates single-tile resource placement.
 */

import type { PlacementContext, PlacementResult } from '../types';
import { validateSingleTilePlacement, canPlaceSingleTile } from './single-tile-validator';

/**
 * Validate resource placement with detailed status.
 * Resources have simpler rules than buildings:
 * - Must be within bounds
 * - Must be on passable terrain
 * - Must not be occupied
 *
 * @param x X coordinate
 * @param y Y coordinate
 * @param ctx Game context for validation
 * @returns Placement result with canPlace and detailed status
 */
export function validateResourcePlacement(
    x: number,
    y: number,
    ctx: PlacementContext
): PlacementResult {
    return validateSingleTilePlacement(x, y, ctx);
}

/**
 * Simple boolean check for resource placement.
 * Use validateResourcePlacement for detailed status.
 */
export function canPlaceResource(
    groundType: Uint8Array,
    mapSize: PlacementContext['mapSize'],
    tileOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    return canPlaceSingleTile(groundType, mapSize, tileOccupancy, x, y);
}

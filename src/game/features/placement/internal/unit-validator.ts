/**
 * Unit placement validation.
 * Validates single-tile unit placement (similar to resources but for units).
 */

import type { TerrainData } from '../../../terrain';
import type { PlacementContext, PlacementResult } from '../types';
import { validateSingleTilePlacement, canPlaceSingleTile } from './single-tile-validator';

/**
 * Validate unit placement with detailed status.
 * Units have similar rules to resources:
 * - Must be within bounds
 * - Must be on passable terrain
 * - Must not be occupied
 *
 * @param x X coordinate
 * @param y Y coordinate
 * @param ctx Game context for validation
 * @returns Placement result with canPlace and detailed status
 */
export function validateUnitPlacement(x: number, y: number, ctx: PlacementContext): PlacementResult {
    return validateSingleTilePlacement(x, y, ctx);
}

/**
 * Simple boolean check for unit placement.
 * Use validateUnitPlacement for detailed status.
 */
export function canPlaceUnit(terrain: TerrainData, tileOccupancy: Map<string, number>, x: number, y: number): boolean {
    return canPlaceSingleTile(terrain, tileOccupancy, x, y);
}

/**
 * Shared single-tile placement validation.
 * Used by unit and resource validators which have identical validation logic.
 */

import { tileKey, isInMapBounds } from '../../../entity';
import type { TerrainData } from '../../../terrain';
import type { PlacementContext, PlacementResult } from '../types';
import { PlacementStatus } from '../types';
import { isPassable } from './terrain';

/**
 * Validate single-tile placement with detailed status.
 * Shared logic for units and resources:
 * - Must be within bounds
 * - Must be on passable terrain
 * - Must not be occupied
 *
 * @param x X coordinate
 * @param y Y coordinate
 * @param ctx Game context for validation
 * @returns Placement result with canPlace and detailed status
 */
export function validateSingleTilePlacement(x: number, y: number, ctx: PlacementContext): PlacementResult {
    // Bounds check
    if (!isInMapBounds(x, y, ctx.mapSize.width, ctx.mapSize.height)) {
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }

    // Policy filter (territory, diplomacy, etc.) — fail fast before terrain checks
    if (ctx.placementFilter && ctx.player !== undefined) {
        const rejection = ctx.placementFilter(x, y, ctx.player);
        if (rejection !== null) {
            return { canPlace: false, status: rejection };
        }
    }

    const idx = ctx.mapSize.toIndex(x, y);

    // Must be passable terrain (not water, rock)
    if (!isPassable(ctx.groundType[idx]!)) {
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }

    // Must not be occupied
    if (ctx.groundOccupancy.has(tileKey(x, y))) {
        return { canPlace: false, status: PlacementStatus.Occupied };
    }

    // Single-tile entities don't care about slope - always "Easy" if valid
    return { canPlace: true, status: PlacementStatus.Easy };
}

/**
 * Simple boolean check for single-tile placement.
 * Use validateSingleTilePlacement for detailed status.
 */
export function canPlaceSingleTile(
    terrain: TerrainData,
    groundOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const ctx: PlacementContext = {
        groundType: terrain.groundType,
        groundHeight: terrain.groundHeight,
        mapSize: terrain.mapSize,
        groundOccupancy,
    };
    return validateSingleTilePlacement(x, y, ctx).canPlace;
}

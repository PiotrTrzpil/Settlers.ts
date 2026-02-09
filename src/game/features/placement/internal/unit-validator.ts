/**
 * Unit placement validation.
 * Validates single-tile unit placement (similar to resources but for units).
 */

import { tileKey } from '../../../entity';
import type { PlacementContext, PlacementResult } from '../types';
import { PlacementStatus } from '../types';
import { isPassable } from './terrain';

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
export function validateUnitPlacement(
    x: number,
    y: number,
    ctx: PlacementContext
): PlacementResult {
    // Bounds check
    if (x < 0 || y < 0 || x >= ctx.mapSize.width || y >= ctx.mapSize.height) {
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }

    const idx = ctx.mapSize.toIndex(x, y);

    // Must be passable terrain (not water, rock)
    if (!isPassable(ctx.groundType[idx])) {
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }

    // Must not be occupied
    if (ctx.tileOccupancy.has(tileKey(x, y))) {
        return { canPlace: false, status: PlacementStatus.Occupied };
    }

    // Units don't care about slope - always "Easy" if valid
    return { canPlace: true, status: PlacementStatus.Easy };
}

/**
 * Simple boolean check for unit placement.
 * Use validateUnitPlacement for detailed status.
 */
export function canPlaceUnit(
    groundType: Uint8Array,
    mapSize: PlacementContext['mapSize'],
    tileOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const ctx: PlacementContext = {
        groundType,
        groundHeight: new Uint8Array(0), // Not needed for units
        mapSize,
        tileOccupancy,
    };
    return validateUnitPlacement(x, y, ctx).canPlace;
}

/**
 * Unit placement validation.
 * Validates single-tile unit placement — checks both ground and unit occupancy
 * since units can't overlap ground entities or other units.
 */

import { tileKey } from '../../../entity';
import type { Tile } from '../../../core/coordinates';
import type { TerrainData } from '../../../terrain';
import type { PlacementContext, PlacementResult } from '../types';
import { PlacementStatus } from '../types';
import { validateSingleTilePlacement } from './single-tile-validator';

/**
 * Extended context for unit placement — includes unit-layer occupancy
 * in addition to the standard PlacementContext (which has groundOccupancy).
 */
export interface UnitPlacementContext extends PlacementContext {
    unitOccupancy: Map<string, number>;
}

/**
 * Validate unit placement with detailed status.
 * Units must pass all single-tile checks (bounds, terrain, ground occupancy)
 * AND must not overlap another unit.
 *
 * @param tile Tile coordinates
 * @param ctx Game context including both ground and unit occupancy
 * @returns Placement result with canPlace and detailed status
 */
export function validateUnitPlacement(tile: Tile, ctx: UnitPlacementContext): PlacementResult {
    // Check ground-layer occupancy (bounds, terrain, ground entities)
    const groundResult = validateSingleTilePlacement(tile, ctx);
    if (!groundResult.canPlace) {
        return groundResult;
    }

    // Check unit-layer occupancy
    if (ctx.unitOccupancy.has(tileKey(tile))) {
        return { canPlace: false, status: PlacementStatus.Occupied };
    }

    return groundResult;
}

/**
 * Simple boolean check for unit placement.
 * Use validateUnitPlacement for detailed status.
 */
export function canPlaceUnit(
    terrain: TerrainData,
    groundOccupancy: Map<string, number>,
    unitOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const ctx: UnitPlacementContext = {
        groundType: terrain.groundType,
        groundHeight: terrain.groundHeight,
        mapSize: terrain.mapSize,
        groundOccupancy,
        unitOccupancy,
    };
    return validateUnitPlacement({ x, y }, ctx).canPlace;
}

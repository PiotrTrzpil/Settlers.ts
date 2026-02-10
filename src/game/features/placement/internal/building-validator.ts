/**
 * Building placement validation.
 * Validates building footprints including terrain, occupancy, and slope.
 */

import { tileKey, getBuildingFootprint, type BuildingType } from '../../../entity';
import type { PlacementContext, PlacementResult } from '../types';
import { PlacementStatus } from '../types';
import { isBuildable } from './terrain';
import { computeSlopeDifficulty } from './slope';

interface TileCoord {
    x: number;
    y: number;
}

/**
 * Check if footprint is within map bounds.
 */
function isFootprintInBounds(footprint: TileCoord[], ctx: PlacementContext): boolean {
    return footprint.every(t =>
        t.x >= 0 && t.x < ctx.mapSize.width && t.y >= 0 && t.y < ctx.mapSize.height
    );
}

/**
 * Check individual tile for basic placement requirements.
 * Returns the blocking status or null if tile is OK.
 */
function checkTileBasics(
    tile: TileCoord,
    ctx: PlacementContext
): PlacementStatus | null {
    const idx = ctx.mapSize.toIndex(tile.x, tile.y);
    if (!isBuildable(ctx.groundType[idx])) return PlacementStatus.InvalidTerrain;
    if (ctx.tileOccupancy.has(tileKey(tile.x, tile.y))) return PlacementStatus.Occupied;
    return null;
}

/**
 * Validate building placement with detailed status.
 *
 * @param x Top-left X coordinate of building footprint
 * @param y Top-left Y coordinate of building footprint
 * @param buildingType Type of building to place
 * @param ctx Game context for validation
 * @returns Placement result with canPlace and detailed status
 */
export function validateBuildingPlacement(
    x: number,
    y: number,
    buildingType: BuildingType,
    ctx: PlacementContext
): PlacementResult {
    const footprint = getBuildingFootprint(x, y, buildingType);

    // Check bounds
    if (!isFootprintInBounds(footprint, ctx)) {
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }

    // Check each tile for terrain and occupancy
    for (const tile of footprint) {
        const blockingStatus = checkTileBasics(tile, ctx);
        if (blockingStatus !== null) {
            return { canPlace: false, status: blockingStatus };
        }
    }

    // Check slope across footprint
    const slopeStatus = computeSlopeDifficulty(footprint, ctx.groundHeight, ctx.mapSize);
    if (slopeStatus === PlacementStatus.TooSteep) {
        return { canPlace: false, status: PlacementStatus.TooSteep };
    }

    return { canPlace: true, status: slopeStatus };
}

/**
 * Simple boolean check for building placement with footprint.
 * Use validateBuildingPlacement for detailed status.
 */
export function canPlaceBuildingFootprint(
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: PlacementContext['mapSize'],
    tileOccupancy: Map<string, number>,
    x: number,
    y: number,
    buildingType: BuildingType
): boolean {
    const ctx: PlacementContext = { groundType, groundHeight, mapSize, tileOccupancy };
    return validateBuildingPlacement(x, y, buildingType, ctx).canPlace;
}

/**
 * Check if a building can be placed at a single tile (x, y).
 * Checks terrain and occupancy only - slope is checked by computeSlopeDifficulty
 * for the full footprint, which is more lenient since terrain leveling handles slopes.
 */
export function canPlaceBuilding(
    groundType: Uint8Array,
    _groundHeight: Uint8Array,
    mapSize: PlacementContext['mapSize'],
    tileOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const idx = mapSize.toIndex(x, y);

    if (!isBuildable(groundType[idx])) {
        return false;
    }

    if (tileOccupancy.has(tileKey(x, y))) {
        return false;
    }

    // Slope is no longer checked here - terrain leveling during construction
    // handles height differences, so we only check terrain type and occupancy.
    // The full footprint slope check in validateBuildingPlacement uses
    // computeSlopeDifficulty which is more sophisticated.

    return true;
}

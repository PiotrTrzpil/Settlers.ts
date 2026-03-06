/**
 * Building placement validation.
 * Validates building footprints including terrain, occupancy, and slope.
 */

import { tileKey, getBuildingFootprint, BuildingType, isMineBuilding } from '../../../entity';
import type { Race } from '../../../race';
import type { TerrainData } from '../../../terrain';
import { getAllNeighbors } from '../../../systems/hex-directions';
import type { PlacementContext, PlacementFilter, PlacementResult } from '../types';
import { PlacementStatus } from '../types';
import { isBuildable, isMineBuildable } from './terrain';
import { computeSlopeDifficulty } from './slope';

interface TileCoord {
    x: number;
    y: number;
}

/**
 * Check if footprint is within map bounds.
 */
function isFootprintInBounds(footprint: TileCoord[], ctx: PlacementContext): boolean {
    return footprint.every(t => t.x >= 0 && t.x < ctx.mapSize.width && t.y >= 0 && t.y < ctx.mapSize.height);
}

/**
 * Check individual tile for basic placement requirements.
 * Mines require rock/mountain terrain; all other buildings reject it.
 * Returns the blocking status or null if tile is OK.
 */
function checkTileBasics(tile: TileCoord, ctx: PlacementContext, isMine: boolean): PlacementStatus | null {
    const idx = ctx.mapSize.toIndex(tile.x, tile.y);
    const terrainOk = isMine ? isMineBuildable(ctx.groundType[idx]!) : isBuildable(ctx.groundType[idx]!);
    if (!terrainOk) return PlacementStatus.InvalidTerrain;
    if (ctx.tileOccupancy.has(tileKey(tile.x, tile.y))) return PlacementStatus.Occupied;
    return null;
}

/**
 * Check placement filter against all footprint tiles.
 * Returns the first rejection status, or null if all tiles pass.
 */
function checkPlacementFilter(footprint: TileCoord[], ctx: PlacementContext): PlacementStatus | null {
    if (!ctx.placementFilter || ctx.player === undefined) return null;
    for (const tile of footprint) {
        const rejection = ctx.placementFilter(tile.x, tile.y, ctx.player);
        if (rejection !== null) return rejection;
    }
    return null;
}

/**
 * Enforce 1-tile gap between building footprints for pathfinding.
 * Rejects if any external neighbor of the new footprint touches any
 * existing building footprint tile (including door corridors).
 */
function footprintTouchesBuilding(footprint: TileCoord[], buildingFootprint: ReadonlySet<string>): boolean {
    const fpKeys = new Set(footprint.map(t => tileKey(t.x, t.y)));
    for (const tile of footprint) {
        for (const n of getAllNeighbors(tile)) {
            const key = tileKey(n.x, n.y);
            if (!fpKeys.has(key) && buildingFootprint.has(key)) {
                return true;
            }
        }
    }
    return false;
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
    if (ctx.race === undefined) {
        throw new Error(
            `validateBuildingPlacement: ctx.race is required for building placement (${BuildingType[buildingType]})`
        );
    }
    const footprint = getBuildingFootprint(x, y, buildingType, ctx.race);
    const isMine = isMineBuilding(buildingType);

    // Check bounds
    if (!isFootprintInBounds(footprint, ctx)) {
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }

    // Policy filter (territory, diplomacy, etc.) — fail fast before terrain checks
    const filterRejection = checkPlacementFilter(footprint, ctx);
    if (filterRejection !== null) {
        return { canPlace: false, status: filterRejection };
    }

    // Check each tile for terrain and occupancy
    for (const tile of footprint) {
        const blockingStatus = checkTileBasics(tile, ctx, isMine);
        if (blockingStatus !== null) {
            return { canPlace: false, status: blockingStatus };
        }
    }

    // 1-tile gap between building footprints for pathfinding
    if (ctx.buildingFootprint && ctx.buildingFootprint.size > 0) {
        if (footprintTouchesBuilding(footprint, ctx.buildingFootprint)) {
            return { canPlace: false, status: PlacementStatus.Occupied };
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
    terrain: TerrainData,
    tileOccupancy: Map<string, number>,
    x: number,
    y: number,
    buildingType: BuildingType,
    race: Race,
    buildingFootprint?: ReadonlySet<string>,
    placementFilter?: PlacementFilter | null,
    player?: number
): boolean {
    const ctx: PlacementContext = {
        groundType: terrain.groundType,
        groundHeight: terrain.groundHeight,
        mapSize: terrain.mapSize,
        tileOccupancy,
        buildingFootprint,
        race,
        placementFilter: placementFilter ?? null,
        player,
    };
    return validateBuildingPlacement(x, y, buildingType, ctx).canPlace;
}

/**
 * Check if a building can be placed at a single tile (x, y).
 * Checks terrain and occupancy only - slope is checked by computeSlopeDifficulty
 * for the full footprint, which is more lenient since terrain leveling handles slopes.
 */
export function canPlaceBuilding(
    terrain: TerrainData,
    tileOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const idx = terrain.toIndex(x, y);

    if (!isBuildable(terrain.groundType[idx]!)) {
        return false;
    }

    if (tileOccupancy.has(tileKey(x, y))) {
        return false;
    }

    return true;
}

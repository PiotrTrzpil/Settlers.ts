/**
 * Building placement validation.
 * Validates building footprints including terrain, occupancy, and slope.
 */

import { tileKey, getBuildingFootprint, getBuildingBlockArea, BuildingType, isMineBuilding } from '../../../entity';
import type { Race } from '../../../core/race';
import type { Tile } from '../../../core/coordinates';
import type { TerrainData } from '../../../terrain';
import type { PlacementContext, PlacementFilter, PlacementResult } from '../types';
import { PlacementStatus } from '../types';
import { isBuildable, isMineBuildable } from './terrain';
import { computeSlopeDifficulty } from './slope';

/**
 * Check if footprint is within map bounds.
 */
function isFootprintInBounds(footprint: Tile[], ctx: PlacementContext): boolean {
    return footprint.every(t => t.x >= 0 && t.x < ctx.mapSize.width && t.y >= 0 && t.y < ctx.mapSize.height);
}

/**
 * Check individual tile for basic placement requirements.
 * Mines require rock/mountain terrain; all other buildings reject it.
 * Returns the blocking status or null if tile is OK.
 */
function checkTileBasics(tile: Tile, ctx: PlacementContext, isMine: boolean): PlacementStatus | null {
    const idx = ctx.mapSize.toIndex(tile.x, tile.y);
    const terrainOk = isMine ? isMineBuildable(ctx.groundType[idx]!) : isBuildable(ctx.groundType[idx]!);
    if (!terrainOk) {
        return PlacementStatus.InvalidTerrain;
    }
    const occupantId = ctx.groundOccupancy.get(tileKey(tile.x, tile.y));
    if (occupantId !== undefined) {
        if (!ctx.isReplaceableOccupant?.(occupantId)) {
            return PlacementStatus.Occupied;
        }
    }
    return null;
}

/**
 * Check placement filter against all footprint tiles.
 * Returns the first rejection status, or null if all tiles pass.
 */
function checkPlacementFilter(footprint: Tile[], ctx: PlacementContext): PlacementStatus | null {
    if (!ctx.placementFilter || ctx.player === undefined) {
        return null;
    }
    for (const tile of footprint) {
        const rejection = ctx.placementFilter(tile.x, tile.y, ctx.player);
        if (rejection !== null) {
            return rejection;
        }
    }
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
    if (ctx.race === undefined) {
        throw new Error(`validateBuildingPlacement: ctx.race is required for building placement (${buildingType})`);
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

    // Mines ignore slope — they embed into the mountain as-is
    if (isMine) {
        return { canPlace: true, status: PlacementStatus.Easy };
    }

    // Check slope across the block area (actual building body), not the full footprint.
    // The outer ring of buildingPosLines is just a spacing buffer — terrain leveling
    // during construction smooths those tiles, so slope there is irrelevant.
    const blockArea = getBuildingBlockArea(x, y, buildingType, ctx.race);
    const slopeStatus = computeSlopeDifficulty(blockArea, ctx.groundHeight, ctx.mapSize);
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
    groundOccupancy: Map<string, number>,
    x: number,
    y: number,
    buildingType: BuildingType,
    race: Race,
    buildingFootprint?: ReadonlySet<string>,
    placementFilter?: PlacementFilter | null,
    player?: number,
    isReplaceableOccupant?: (entityId: number) => boolean
): boolean {
    const ctx: PlacementContext = {
        groundType: terrain.groundType,
        groundHeight: terrain.groundHeight,
        mapSize: terrain.mapSize,
        groundOccupancy,
        buildingFootprint,
        race,
        // eslint-disable-next-line no-restricted-syntax -- optional dependency; null when not wired
        placementFilter: placementFilter ?? null,
        player,
        isReplaceableOccupant,
    };
    return validateBuildingPlacement(x, y, buildingType, ctx).canPlace;
}

/**
 * Check if a building can be placed at a single tile (x, y).
 * Checks terrain and occupancy only — slope is checked by computeSlopeDifficulty
 * on the block area (inner building body), not this single tile.
 */
export function canPlaceBuilding(
    terrain: TerrainData,
    groundOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const idx = terrain.toIndex(x, y);

    if (!isBuildable(terrain.groundType[idx]!)) {
        return false;
    }

    const occupantId = groundOccupancy.get(tileKey(x, y));
    if (occupantId !== undefined) {
        return false;
    }

    return true;
}

/**
 * Terrain capture and leveling for building construction.
 * Handles ground type and height modifications during construction.
 *
 * When a building is constructed, ALL tiles in its footprint get their ground
 * type changed to the construction site material (raw earth). Cardinal neighbors
 * of the footprint are also captured so their heights can be smoothly leveled.
 */

import { CARDINAL_OFFSETS } from '../../core/coordinates';
import { getBuildingFootprint } from '../../buildings/types';
import type { BuildingType } from '../../buildings/types';
import type { Race } from '../../core/race';
import type { ConstructionSiteOriginalTerrain, CapturedTerrainTile } from './types';
import { MapSize } from '@/utilities/map-size';
import { LandscapeType } from '../../renderer/landscape/landscape-type';

/** Ground type used for construction sites (raw/leveled earth) */
export const CONSTRUCTION_SITE_GROUND_TYPE = LandscapeType.DustyWay;

/**
 * Narrow parameter interface for terrain functions.
 * Satisfied by both ConstructionSite and temporary param objects in populateMapBuildings.
 */
export interface TerrainBuildingParams {
    buildingType: BuildingType;
    race: Race;
    tileX: number;
    tileY: number;
}

/**
 * Captures the original terrain state before construction begins.
 * Call this when entering the TerrainLeveling phase.
 *
 * Captures all tiles in the building footprint (marked isFootprint=true)
 * plus their cardinal neighbors (isFootprint=false) for smooth height transitions.
 * The target height is the average height across all captured tiles.
 */
export function captureOriginalTerrain(
    params: TerrainBuildingParams,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): ConstructionSiteOriginalTerrain {
    const tiles: CapturedTerrainTile[] = [];

    // Track which tiles we've already captured (by map index) to avoid duplicates
    const captured = new Set<number>();

    // Get all tiles in the building footprint
    const footprint = getBuildingFootprint(params.tileX, params.tileY, params.buildingType, params.race);

    // Capture all footprint tiles
    for (const tile of footprint) {
        if (tile.x < 0 || tile.x >= mapSize.width || tile.y < 0 || tile.y >= mapSize.height) {
            continue;
        }
        const idx = mapSize.toIndex(tile.x, tile.y);
        captured.add(idx);
        tiles.push({
            x: tile.x,
            y: tile.y,
            originalGroundType: groundType[idx]!,
            originalGroundHeight: groundHeight[idx]!,
            isFootprint: true,
        });
    }

    // Capture cardinal neighbors of the footprint for smooth height transitions
    for (const tile of footprint) {
        for (const [dx, dy] of CARDINAL_OFFSETS) {
            const nx = tile.x + dx;
            const ny = tile.y + dy;
            if (nx < 0 || nx >= mapSize.width || ny < 0 || ny >= mapSize.height) {
                continue;
            }
            const nIdx = mapSize.toIndex(nx, ny);
            if (captured.has(nIdx)) {
                continue;
            }
            captured.add(nIdx);

            tiles.push({
                x: nx,
                y: ny,
                originalGroundType: groundType[nIdx]!,
                originalGroundHeight: groundHeight[nIdx]!,
                isFootprint: false,
            });
        }
    }

    // Target height is the average of all captured tiles (footprint + neighbors)
    let totalHeight = 0;
    for (const tile of tiles) {
        totalHeight += tile.originalGroundHeight;
    }
    const targetHeight = Math.round(totalHeight / tiles.length);

    return { tiles, targetHeight };
}

/**
 * Applies terrain leveling based on construction progress.
 * Called during the TerrainLeveling phase to gradually modify terrain.
 *
 * Heights are interpolated toward the target for all captured tiles.
 * Ground type is changed to construction site material for footprint tiles only.
 *
 * @param _params Building location and type params (interface compatibility — not used internally)
 * @param groundType Ground type array to modify
 * @param groundHeight Ground height array to modify
 * @param mapSize Map dimensions
 * @param levelingProgress Progress through the leveling phase (0.0 to 1.0)
 * @param originalTerrain Previously captured terrain state
 * @returns true if terrain was modified
 */
export function applyTerrainLeveling(
    _params: TerrainBuildingParams,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    levelingProgress: number,
    originalTerrain: ConstructionSiteOriginalTerrain
): boolean {
    let modified = false;

    for (const tile of originalTerrain.tiles) {
        const idx = mapSize.toIndex(tile.x, tile.y);

        // Interpolate height from original toward target
        const newHeight = Math.round(
            tile.originalGroundHeight + (originalTerrain.targetHeight - tile.originalGroundHeight) * levelingProgress
        );

        if (groundHeight[idx] !== newHeight) {
            groundHeight[idx] = newHeight;
            modified = true;
        }

        // Change ground type to construction site material for footprint tiles
        if (tile.isFootprint && levelingProgress > 0) {
            if (groundType[idx] !== CONSTRUCTION_SITE_GROUND_TYPE) {
                groundType[idx] = CONSTRUCTION_SITE_GROUND_TYPE;
                modified = true;
            }
        }
    }

    return modified;
}

/**
 * Apply terrain leveling for a single tile.
 * Sets the tile's height to the target height and changes ground type for footprint tiles.
 * Called by construction-system when a digger completes one tile.
 *
 * @param tileX Tile X coordinate
 * @param tileY Tile Y coordinate
 * @param targetHeight The target leveled height
 * @param isFootprint Whether this tile is part of the building footprint
 * @param groundType Ground type array to modify
 * @param groundHeight Ground height array to modify
 * @param mapSize Map dimensions
 * @returns true if terrain was actually modified
 */
export function applySingleTileLeveling(
    tileX: number,
    tileY: number,
    targetHeight: number,
    isFootprint: boolean,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): boolean {
    const idx = mapSize.toIndex(tileX, tileY);
    let modified = false;

    if (groundHeight[idx] !== targetHeight) {
        groundHeight[idx] = targetHeight;
        modified = true;
    }

    if (isFootprint && groundType[idx] !== CONSTRUCTION_SITE_GROUND_TYPE) {
        groundType[idx] = CONSTRUCTION_SITE_GROUND_TYPE;
        modified = true;
    }

    return modified;
}

/**
 * Sets ground type to construction site material for all footprint tiles.
 * Called immediately at placement time so the ground looks "raw" right away,
 * before height leveling begins.
 *
 * @param _params Building location and type params (interface compatibility — not used internally)
 * @param groundType Ground type array to modify
 * @param mapSize Map dimensions
 * @param originalTerrain Previously captured terrain state
 * @returns true if any ground type was changed
 */
export function setConstructionSiteGroundType(
    _params: TerrainBuildingParams,
    groundType: Uint8Array,
    mapSize: MapSize,
    originalTerrain: ConstructionSiteOriginalTerrain
): boolean {
    let modified = false;
    for (const tile of originalTerrain.tiles) {
        if (!tile.isFootprint) {
            continue;
        }
        const idx = mapSize.toIndex(tile.x, tile.y);
        if (groundType[idx] !== CONSTRUCTION_SITE_GROUND_TYPE) {
            groundType[idx] = CONSTRUCTION_SITE_GROUND_TYPE;
            modified = true;
        }
    }
    return modified;
}

/**
 * Restores original terrain when a building is cancelled/removed during construction.
 * Should be called before removing the building entity.
 *
 * @param originalTerrain Previously captured terrain state to restore from
 * @param groundType Ground type array to modify
 * @param groundHeight Ground height array to modify
 * @param mapSize Map dimensions
 * @returns true if terrain was modified
 */
export function restoreOriginalTerrain(
    originalTerrain: ConstructionSiteOriginalTerrain,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): boolean {
    let modified = false;

    for (const tile of originalTerrain.tiles) {
        const idx = mapSize.toIndex(tile.x, tile.y);

        if (groundType[idx] !== tile.originalGroundType) {
            groundType[idx] = tile.originalGroundType;
            modified = true;
        }

        if (groundHeight[idx] !== tile.originalGroundHeight) {
            groundHeight[idx] = tile.originalGroundHeight;
            modified = true;
        }
    }

    return modified;
}

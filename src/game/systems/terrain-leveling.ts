/**
 * Terrain leveling system for building construction.
 * Handles ground type and height modifications during construction.
 *
 * When a building is constructed, ALL tiles in its footprint get their ground
 * type changed to the construction site material (raw earth). Cardinal neighbors
 * of the footprint are also captured so their heights can be smoothly leveled.
 */

import { CARDINAL_OFFSETS, tileKey, BuildingState, ConstructionSiteOriginalTerrain, getBuildingFootprint } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { LandscapeType } from '../renderer/landscape/landscape-type';

/** Ground type used for construction sites (raw/leveled earth) */
export const CONSTRUCTION_SITE_GROUND_TYPE = LandscapeType.DustyWay;

/**
 * Captures the original terrain state before construction begins.
 * Call this when entering the TerrainLeveling phase.
 *
 * Captures all tiles in the building footprint plus their cardinal neighbors.
 * The target height is the average height across all captured tiles.
 */
export function captureOriginalTerrain(
    buildingState: BuildingState,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): ConstructionSiteOriginalTerrain {
    const groundTypes = new Map<string, number>();
    const groundHeights = new Map<string, number>();

    // Get all tiles in the building footprint
    const footprint = getBuildingFootprint(buildingState.tileX, buildingState.tileY, buildingState.buildingType);

    // Capture all footprint tiles
    for (const tile of footprint) {
        if (tile.x < 0 || tile.x >= mapSize.width || tile.y < 0 || tile.y >= mapSize.height) {
            continue;
        }
        const idx = mapSize.toIndex(tile.x, tile.y);
        const key = tileKey(tile.x, tile.y);
        groundTypes.set(key, groundType[idx]);
        groundHeights.set(key, groundHeight[idx]);
    }

    // Capture cardinal neighbors of the footprint for smooth height transitions.
    // Only add tiles that aren't already part of the footprint.
    for (const tile of footprint) {
        for (const [dx, dy] of CARDINAL_OFFSETS) {
            const nx = tile.x + dx;
            const ny = tile.y + dy;
            const nKey = tileKey(nx, ny);

            // Skip if already captured (footprint tile or neighbor of another footprint tile)
            if (groundHeights.has(nKey)) continue;

            if (nx < 0 || nx >= mapSize.width || ny < 0 || ny >= mapSize.height) {
                continue;
            }

            const nIdx = mapSize.toIndex(nx, ny);
            groundTypes.set(nKey, groundType[nIdx]);
            groundHeights.set(nKey, groundHeight[nIdx]);
        }
    }

    // Target height is the average of all captured tiles (footprint + neighbors)
    let totalHeight = 0;
    for (const h of groundHeights.values()) {
        totalHeight += h;
    }
    const targetHeight = Math.round(totalHeight / groundHeights.size);

    return {
        groundTypes,
        groundHeights,
        targetHeight,
    };
}

/**
 * Applies terrain leveling based on construction progress.
 * Called during the TerrainLeveling phase to gradually modify terrain.
 *
 * Heights are interpolated toward the target for all captured tiles.
 * Ground type is changed to construction site material for all footprint tiles.
 *
 * @param buildingState The building state being constructed
 * @param groundType Ground type array to modify
 * @param groundHeight Ground height array to modify
 * @param mapSize Map dimensions
 * @param levelingProgress Progress through the leveling phase (0.0 to 1.0)
 * @returns true if terrain was modified
 */
export function applyTerrainLeveling(
    buildingState: BuildingState,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    levelingProgress: number
): boolean {
    const original = buildingState.originalTerrain;
    if (!original) return false;

    let modified = false;

    // Build a set of footprint tile keys for O(1) lookup
    const footprint = getBuildingFootprint(buildingState.tileX, buildingState.tileY, buildingState.buildingType);
    const footprintKeys = new Set<string>();
    for (const tile of footprint) {
        footprintKeys.add(tileKey(tile.x, tile.y));
    }

    // Iterate over all captured tiles (footprint + neighbors)
    for (const [key, originalHeight] of original.groundHeights) {
        const [xStr, yStr] = key.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);

        if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) {
            continue;
        }

        const idx = mapSize.toIndex(x, y);

        // Interpolate height from original toward target
        const newHeight = Math.round(
            originalHeight + (original.targetHeight - originalHeight) * levelingProgress
        );

        if (groundHeight[idx] !== newHeight) {
            groundHeight[idx] = newHeight;
            modified = true;
        }

        // Change ground type to construction site material for all footprint tiles
        if (footprintKeys.has(key) && levelingProgress > 0) {
            if (groundType[idx] !== CONSTRUCTION_SITE_GROUND_TYPE) {
                groundType[idx] = CONSTRUCTION_SITE_GROUND_TYPE;
                modified = true;
            }
        }
    }

    return modified;
}

/**
 * Restores original terrain when a building is cancelled/removed during construction.
 * Should be called before removing the building entity.
 */
export function restoreOriginalTerrain(
    buildingState: BuildingState,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): boolean {
    const original = buildingState.originalTerrain;
    if (!original) return false;

    let modified = false;

    for (const [key, originalType] of original.groundTypes) {
        const [xStr, yStr] = key.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);

        if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) {
            continue;
        }

        const idx = mapSize.toIndex(x, y);

        // Restore original ground type
        if (groundType[idx] !== originalType) {
            groundType[idx] = originalType;
            modified = true;
        }

        // Restore original height
        const originalHeight = original.groundHeights.get(key);
        if (originalHeight !== undefined && groundHeight[idx] !== originalHeight) {
            groundHeight[idx] = originalHeight;
            modified = true;
        }
    }

    return modified;
}

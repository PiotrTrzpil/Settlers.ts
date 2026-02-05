/**
 * Terrain leveling system for building construction.
 * Handles ground type and height modifications during construction.
 */

import { CARDINAL_OFFSETS, tileKey, BuildingState, ConstructionSiteOriginalTerrain } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { LandscapeType } from '../renderer/landscape/landscape-type';

/** Ground type used for construction sites (raw/leveled earth) */
export const CONSTRUCTION_SITE_GROUND_TYPE = LandscapeType.DustyWay;

/**
 * Captures the original terrain state before construction begins.
 * Call this when entering the TerrainLeveling phase.
 */
export function captureOriginalTerrain(
    buildingState: BuildingState,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): ConstructionSiteOriginalTerrain {
    const { tileX, tileY } = buildingState;
    const groundTypes = new Map<string, number>();
    const groundHeights = new Map<string, number>();

    // Capture the building tile itself
    const centerIdx = mapSize.toIndex(tileX, tileY);
    const key = tileKey(tileX, tileY);
    groundTypes.set(key, groundType[centerIdx]);
    groundHeights.set(key, groundHeight[centerIdx]);

    // Capture cardinal neighbors for smooth transitions
    let totalHeight = groundHeight[centerIdx];
    let heightCount = 1;

    for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = tileX + dx;
        const ny = tileY + dy;
        if (nx < 0 || nx >= mapSize.width || ny < 0 || ny >= mapSize.height) {
            continue;
        }
        const nIdx = mapSize.toIndex(nx, ny);
        const nKey = tileKey(nx, ny);
        groundTypes.set(nKey, groundType[nIdx]);
        groundHeights.set(nKey, groundHeight[nIdx]);
        totalHeight += groundHeight[nIdx];
        heightCount++;
    }

    // Target height is the average of the building tile and its neighbors
    const targetHeight = Math.round(totalHeight / heightCount);

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

    const { tileX, tileY } = buildingState;
    let modified = false;

    // Iterate over all captured tiles
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

        // Change ground type to construction site material at the building tile
        // Do this immediately at the start of leveling
        if (x === tileX && y === tileY && levelingProgress > 0) {
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

/**
 * Slope calculation for placement validation.
 * Part of the public API — used by building indicator renderer.
 */

import type { MapSize } from '@/utilities/map-size';
import { PlacementStatus } from './types';

/** Maximum height difference allowed for building placement */
export const MAX_SLOPE_DIFF = 2;

interface TileCoord {
    x: number;
    y: number;
}

/**
 * Compute slope difficulty rating for a set of tiles.
 * Returns the worst (most difficult) status based on height differences.
 */
export function computeSlopeDifficulty(
    tiles: TileCoord[],
    groundHeight: Uint8Array,
    mapSize: MapSize
): PlacementStatus {
    if (tiles.length === 0) return PlacementStatus.Easy;
    if (tiles.length === 1) return PlacementStatus.Easy;

    let minHeight = 255;
    let maxHeight = 0;

    for (const tile of tiles) {
        const h = groundHeight[mapSize.toIndex(tile.x, tile.y)];
        minHeight = Math.min(minHeight, h);
        maxHeight = Math.max(maxHeight, h);
    }

    const heightDiff = maxHeight - minHeight;
    if (heightDiff > MAX_SLOPE_DIFF) return PlacementStatus.TooSteep;
    if (heightDiff === 0) return PlacementStatus.Easy;
    if (heightDiff === 1) return PlacementStatus.Medium;
    return PlacementStatus.Difficult;
}

/**
 * Check if slope is valid (within MAX_SLOPE_DIFF).
 */
export function isSlopeValid(
    tiles: TileCoord[],
    groundHeight: Uint8Array,
    mapSize: MapSize
): boolean {
    const status = computeSlopeDifficulty(tiles, groundHeight, mapSize);
    return status !== PlacementStatus.TooSteep;
}

/**
 * Slope calculation for placement validation.
 * Part of the public API — used by building indicator renderer.
 */

import type { MapSize } from '@/utilities/map-size';
import { CARDINAL_OFFSETS, isInMapBounds, type Tile } from '../../core/coordinates';
import { PlacementStatus } from './types';

/**
 * Maximum height difference allowed between adjacent tiles for building placement.
 * Empirically derived from 374 original maps: all buildings have adjacent diffs ≤ 12.
 */
export const MAX_SLOPE_DIFF = 12;

/**
 * Compute slope difficulty rating for a set of tiles using per-tile gradient.
 *
 * Instead of checking min/max across all tiles (which is too restrictive for large
 * footprints), this checks that each tile's height difference from its neighbors
 * WITHIN the footprint is within MAX_SLOPE_DIFF. This allows natural slopes while
 * preventing cliffs.
 *
 * External neighbors (outside the footprint) are NOT checked because terrain
 * leveling during construction will smooth those edges anyway.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- iterative slope calculation over tile neighbours
export function computeSlopeDifficulty(tiles: Tile[], groundHeight: Uint8Array, mapSize: MapSize): PlacementStatus {
    if (tiles.length === 0) {
        return PlacementStatus.Easy;
    }
    if (tiles.length === 1) {
        return PlacementStatus.Easy;
    }

    // Build a set of footprint tile indices for quick lookup
    const footprintSet = new Set<number>();
    for (const tile of tiles) {
        footprintSet.add(mapSize.toIndex(tile.x, tile.y));
    }

    let maxGradient = 0;

    // Check each tile's gradient against its cardinal neighbors WITHIN the footprint
    for (const tile of tiles) {
        const idx = mapSize.toIndex(tile.x, tile.y);
        const h = groundHeight[idx]!;

        for (const [dx, dy] of CARDINAL_OFFSETS) {
            const nx = tile.x + dx;
            const ny = tile.y + dy;

            // Skip out-of-bounds neighbors
            if (!isInMapBounds(nx, ny, mapSize.width, mapSize.height)) {
                continue;
            }

            const nIdx = mapSize.toIndex(nx, ny);

            // Only check neighbors that are also in the footprint
            // External neighbors are handled by terrain leveling during construction
            if (!footprintSet.has(nIdx)) {
                continue;
            }

            const nh = groundHeight[nIdx]!;
            const diff = Math.abs(h - nh);

            if (diff > MAX_SLOPE_DIFF) {
                return PlacementStatus.TooSteep;
            }
            maxGradient = Math.max(maxGradient, diff);
        }
    }

    // Rate difficulty based on maximum gradient found
    if (maxGradient <= 2) {
        return PlacementStatus.Easy;
    }
    if (maxGradient <= 5) {
        return PlacementStatus.Medium;
    }
    return PlacementStatus.Difficult;
}

/**
 * Check if slope is valid (within MAX_SLOPE_DIFF).
 */
export function isSlopeValid(tiles: Tile[], groundHeight: Uint8Array, mapSize: MapSize): boolean {
    const status = computeSlopeDifficulty(tiles, groundHeight, mapSize);
    return status !== PlacementStatus.TooSteep;
}

/**
 * Compute the maximum per-tile gradient across a footprint.
 * Returns the largest height difference between any tile and its cardinal
 * neighbor within the footprint — the same metric used by computeSlopeDifficulty.
 * Used for continuous color gradients in the building indicator.
 */
export function computeHeightRange(tiles: Tile[], groundHeight: Uint8Array, mapSize: MapSize): number {
    if (tiles.length <= 1) {
        return 0;
    }

    const footprintSet = new Set<number>();
    for (const tile of tiles) {
        footprintSet.add(mapSize.toIndex(tile.x, tile.y));
    }

    let maxGradient = 0;

    for (const tile of tiles) {
        const h = groundHeight[mapSize.toIndex(tile.x, tile.y)]!;
        for (const [dx, dy] of CARDINAL_OFFSETS) {
            const nx = tile.x + dx;
            const ny = tile.y + dy;
            if (!isInMapBounds(nx, ny, mapSize.width, mapSize.height)) {
                continue;
            }
            const nIdx = mapSize.toIndex(nx, ny);
            if (!footprintSet.has(nIdx)) {
                continue;
            }
            maxGradient = Math.max(maxGradient, Math.abs(h - groundHeight[nIdx]!));
        }
    }

    return maxGradient;
}

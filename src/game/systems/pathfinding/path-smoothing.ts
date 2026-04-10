/**
 * Path smoothing utilities for post-processing A* paths.
 *
 * These functions reduce unnecessary waypoints by using line-of-sight
 * checks to find shortcuts through the path.
 */

import { Tile, tileKey, isInMapBounds } from '../../entity';
import { isPassable } from '../../terrain';
import { getHexLine } from './hex-line';

/**
 * Parameters for path smoothing.
 */
export interface PathSmoothingParams {
    groundType: Uint8Array;
    mapWidth: number;
    mapHeight: number;
    buildingOccupancy: Set<string>;
}

/**
 * Check if we can walk in a straight line from start to end.
 * Uses hex grid line drawing to check all tiles along the path.
 */
function hasLineOfSight(start: Tile, end: Tile, params: PathSmoothingParams): boolean {
    const tiles = getHexLine(start, end);
    const { groundType, mapWidth, mapHeight, buildingOccupancy } = params;

    // Check each intermediate tile (skip start, include end)
    for (let i = 1; i < tiles.length; i++) {
        const tile = tiles[i]!;

        // Bounds check
        if (!isInMapBounds(tile, mapWidth, mapHeight)) {
            return false;
        }

        // Terrain check
        const idx = tile.x + tile.y * mapWidth;
        if (!isPassable(groundType[idx]!)) {
            return false;
        }

        // Building footprints block line-of-sight (end tile allowed for building interaction)
        const isEnd = tile.x === end.x && tile.y === end.y;
        if (!isEnd && buildingOccupancy.has(tileKey(tile))) {
            return false;
        }
    }

    return true;
}

/**
 * Find the furthest waypoint visible from the current position.
 * Uses binary-search-like optimization for long paths.
 */
function findFurthestVisible(current: Tile, path: Tile[], startIdx: number, params: PathSmoothingParams): number {
    // Try from the end backwards to find the furthest visible point
    for (let j = path.length - 1; j > startIdx; j--) {
        if (hasLineOfSight(current, path[j]!, params)) {
            return j;
        }
    }
    return startIdx;
}

/**
 * Smooth a path by removing unnecessary intermediate waypoints.
 *
 * Uses line-of-sight checks to find shortcuts, then expands the result
 * back into a tile-by-tile path using hex lines.
 *
 * @param path The raw path from A* (array of waypoints)
 * @param startX Starting X coordinate
 * @param startY Starting Y coordinate
 * @param params Smoothing parameters (terrain, occupancy, etc.)
 * @returns Smoothed path as tile-by-tile waypoints
 */
export function smoothPath(path: Tile[], start: Tile, params: PathSmoothingParams): Tile[] {
    if (path.length <= 1) {
        return path;
    }

    // First pass: find key waypoints using line-of-sight
    const keyWaypoints: Tile[] = [];
    let current: Tile = start;
    let i = 0;

    while (i < path.length) {
        const furthest = findFurthestVisible(current, path, i, params);

        keyWaypoints.push(path[furthest]!);
        current = path[furthest]!;
        i = furthest + 1;
    }

    // Second pass: expand key waypoints into tile-by-tile path
    const smoothed: Tile[] = [];
    current = start;

    for (const waypoint of keyWaypoints) {
        const lineTiles = getHexLine(current, waypoint);

        // Add all tiles except the first (which is current position)
        for (let k = 1; k < lineTiles.length; k++) {
            smoothed.push(lineTiles[k]!);
        }

        current = waypoint;
    }

    return smoothed;
}

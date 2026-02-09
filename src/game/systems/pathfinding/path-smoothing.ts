/**
 * Path smoothing utilities for post-processing A* paths.
 *
 * These functions reduce unnecessary waypoints by using line-of-sight
 * checks to find shortcuts through the path.
 */

import { TileCoord, tileKey } from '../../entity';
import { isPassable } from '../../features/placement';
import { getHexLine } from './hex-line';

/**
 * Parameters for path smoothing.
 */
export interface PathSmoothingParams {
    groundType: Uint8Array;
    mapWidth: number;
    mapHeight: number;
    tileOccupancy: Map<string, number>;
    ignoreOccupancy: boolean;
}

/**
 * Check if we can walk in a straight line from start to end.
 * Uses hex grid line drawing to check all tiles along the path.
 */
function hasLineOfSight(
    startX: number, startY: number,
    endX: number, endY: number,
    params: PathSmoothingParams
): boolean {
    const tiles = getHexLine(startX, startY, endX, endY);
    const { groundType, mapWidth, mapHeight, tileOccupancy, ignoreOccupancy } = params;

    // Check each intermediate tile (skip start, include end)
    for (let i = 1; i < tiles.length; i++) {
        const { x, y } = tiles[i];

        // Bounds check
        if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) {
            return false;
        }

        // Terrain check
        const idx = x + y * mapWidth;
        if (!isPassable(groundType[idx])) {
            return false;
        }

        // Occupancy check (allow the end tile even if occupied)
        const isEnd = x === endX && y === endY;
        if (!ignoreOccupancy && !isEnd && tileOccupancy.has(tileKey(x, y))) {
            return false;
        }
    }

    return true;
}

/**
 * Find the furthest waypoint visible from the current position.
 * Uses binary-search-like optimization for long paths.
 */
function findFurthestVisible(
    currentX: number, currentY: number,
    path: TileCoord[],
    startIdx: number,
    params: PathSmoothingParams
): number {
    // Try from the end backwards to find the furthest visible point
    for (let j = path.length - 1; j > startIdx; j--) {
        if (hasLineOfSight(currentX, currentY, path[j].x, path[j].y, params)) {
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
export function smoothPath(
    path: TileCoord[],
    startX: number, startY: number,
    params: PathSmoothingParams
): TileCoord[] {
    if (path.length <= 1) {
        return path;
    }

    // First pass: find key waypoints using line-of-sight
    const keyWaypoints: TileCoord[] = [];
    let currentX = startX;
    let currentY = startY;
    let i = 0;

    while (i < path.length) {
        const furthest = findFurthestVisible(currentX, currentY, path, i, params);

        keyWaypoints.push(path[furthest]);
        currentX = path[furthest].x;
        currentY = path[furthest].y;
        i = furthest + 1;
    }

    // Second pass: expand key waypoints into tile-by-tile path
    const smoothed: TileCoord[] = [];
    currentX = startX;
    currentY = startY;

    for (const waypoint of keyWaypoints) {
        const lineTiles = getHexLine(currentX, currentY, waypoint.x, waypoint.y);

        // Add all tiles except the first (which is current position)
        for (let k = 1; k < lineTiles.length; k++) {
            smoothed.push(lineTiles[k]);
        }

        currentX = waypoint.x;
        currentY = waypoint.y;
    }

    return smoothed;
}

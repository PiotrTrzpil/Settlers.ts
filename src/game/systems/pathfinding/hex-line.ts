/**
 * Hex grid line drawing utilities.
 *
 * Provides functions for drawing lines on hex grids using cube coordinate
 * interpolation. This is the hex equivalent of Bresenham's line algorithm.
 */

import { TileCoord } from '../../entity';
import { hexDistance } from '../hex-directions';

/**
 * Round fractional cube coordinates (q, r, s) to the nearest hex tile.
 *
 * Uses the constraint q + r + s = 0 to fix rounding errors by adjusting
 * the component with the largest rounding difference.
 */
export function cubeRound(q: number, r: number, s: number): TileCoord {
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);

    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);

    // Fix rounding errors by adjusting the component with largest diff
    if (dq > dr && dq > ds) {
        rq = -rr - rs;
    } else if (dr > ds) {
        rr = -rq - rs;
    }
    // Note: s is derived from q and r, so no need to store it

    return { x: rq, y: rr };
}

/**
 * Generate all tiles along a hex grid line from (x1, y1) to (x2, y2).
 *
 * Uses linear interpolation in cube coordinate space, then rounds each
 * point to the nearest hex tile. This produces a smooth line that visits
 * exactly hexDistance(start, end) + 1 tiles.
 *
 * @param x1 Start X coordinate
 * @param y1 Start Y coordinate
 * @param x2 End X coordinate
 * @param y2 End Y coordinate
 * @returns Array of tile coordinates from start to end (inclusive)
 */
export function getHexLine(x1: number, y1: number, x2: number, y2: number): TileCoord[] {
    const n = hexDistance(x1, y1, x2, y2);

    if (n === 0) {
        return [{ x: x1, y: y1 }];
    }

    const results: TileCoord[] = [];

    // Convert offset coordinates to cube coordinates
    // For our hex grid: q = x, r = y, s = -(x + y)
    const q1 = x1, r1 = y1, s1 = -(x1 + y1);
    const q2 = x2, r2 = y2, s2 = -(x2 + y2);

    for (let i = 0; i <= n; i++) {
        const t = i / n;

        // Linear interpolation in cube space
        const q = q1 + (q2 - q1) * t;
        const r = r1 + (r2 - r1) * t;
        const s = s1 + (s2 - s1) * t;

        // Round to nearest hex and add to results
        results.push(cubeRound(q, r, s));
    }

    return results;
}

/**
 * Check if all tiles along a hex line are passable.
 *
 * @param startX Line start X
 * @param startY Line start Y
 * @param endX Line end X
 * @param endY Line end Y
 * @param isPassableFn Function to check if a tile is passable
 * @returns true if all tiles along the line are passable
 */
export function isHexLinePassable(
    startX: number, startY: number,
    endX: number, endY: number,
    isPassableFn: (x: number, y: number) => boolean
): boolean {
    const tiles = getHexLine(startX, startY, endX, endY);

    // Check all tiles (skip start since we're already there)
    for (let i = 1; i < tiles.length; i++) {
        if (!isPassableFn(tiles[i].x, tiles[i].y)) {
            return false;
        }
    }

    return true;
}

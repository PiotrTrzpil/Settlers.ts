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
 * point to the nearest hex tile, followed by a reorder pass that groups
 * same-direction steps into runs of 2+ to reduce visual zigzag.
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
    const q1 = x1,
        r1 = y1,
        s1 = -(x1 + y1);
    const q2 = x2,
        r2 = y2,
        s2 = -(x2 + y2);

    for (let i = 0; i <= n; i++) {
        const t = i / n;

        // Linear interpolation in cube space
        const q = q1 + (q2 - q1) * t;
        const r = r1 + (r2 - r1) * t;
        const s = s1 + (s2 - s1) * t;

        // Round to nearest hex and add to results
        results.push(cubeRound(q, r, s));
    }

    return groupDirectionRuns(results);
}

/**
 * Reorder tiles in a hex line to create longer same-direction runs.
 *
 * The standard cube interpolation distributes direction changes maximally
 * evenly (e.g. E,SE,E,SE,E,SE). This function swaps adjacent pairs to
 * create runs of 2 (e.g. E,E,SE,SE,E,SE), which looks more natural.
 *
 * Each swap preserves the property that consecutive tiles are hex neighbors,
 * because swapping two adjacent hex steps (A then B → B then A) always
 * produces valid hex neighbors (the intermediate tile changes but both
 * directions are valid hex moves from any tile).
 */
export function groupDirectionRuns(tiles: TileCoord[]): TileCoord[] {
    if (tiles.length <= 3) return tiles;

    // Extract step directions as (dx, dy) pairs
    const n = tiles.length - 1;
    const dirs: Array<{ dx: number; dy: number }> = [];
    for (let i = 0; i < n; i++) {
        dirs.push({
            dx: tiles[i + 1]!.x - tiles[i]!.x,
            dy: tiles[i + 1]!.y - tiles[i]!.y,
        });
    }

    // Single pass: swap adjacent steps to extend runs.
    // Pattern: if we see X, Y, X (singleton Y between two X's),
    // swap Y and the second X to get X, X, Y — extending the X run.
    // Skip the swap if it would create a run of 3+ (keep runs at ~2).
    let i = 0;
    while (i < dirs.length - 2) {
        const curr = dirs[i]!;
        const next = dirs[i + 1]!;
        const after = dirs[i + 2]!;

        if (curr.dx === after.dx && curr.dy === after.dy && (curr.dx !== next.dx || curr.dy !== next.dy)) {
            // Would this create a run of 3+? Check if previous step is same direction.
            if (i > 0 && dirs[i - 1]!.dx === after.dx && dirs[i - 1]!.dy === after.dy) {
                i++;
                continue;
            }

            // Swap: [i+1] and [i+2]
            dirs[i + 1] = after;
            dirs[i + 2] = next;
            i += 3; // Skip past the created run
        } else {
            i++;
        }
    }

    // Rebuild tile coordinates from directions
    const result: TileCoord[] = [tiles[0]!];
    let x = tiles[0]!.x;
    let y = tiles[0]!.y;
    for (const dir of dirs) {
        x += dir.dx;
        y += dir.dy;
        result.push({ x, y });
    }

    return result;
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
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    isPassableFn: (x: number, y: number) => boolean
): boolean {
    const tiles = getHexLine(startX, startY, endX, endY);

    // Check all tiles (skip start since we're already there)
    for (let i = 1; i < tiles.length; i++) {
        if (!isPassableFn(tiles[i]!.x, tiles[i]!.y)) {
            return false;
        }
    }

    return true;
}

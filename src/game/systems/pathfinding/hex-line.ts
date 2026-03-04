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

// ═══════════════════════════════════════════════════════════════════════════
// DIRECTION RUN LENGTH CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Module-level direction run length for hex line grouping.
 * Controls how many tiles a unit moves in one direction before turning.
 * - 1 = maximum zigzag (alternating every tile, like raw cube interpolation)
 * - 2 = mild grouping (current visual default)
 * - 8 = moderate straightness (recommended default)
 * - 20+ = very straight paths with sharp turns
 */
let _directionRunLength = 8;

/**
 * Set the direction run length for hex line grouping.
 * Called from game initialization to sync with GameSettings.pathStraightness.
 */
export function setDirectionRunLength(length: number): void {
    _directionRunLength = Math.max(1, Math.min(50, Math.round(length)));
}

interface Dir {
    dx: number;
    dy: number;
}

/** Extract step directions from a tile sequence. */
function extractStepDirs(tiles: TileCoord[]): Dir[] {
    const dirs: Dir[] = [];
    for (let i = 0; i < tiles.length - 1; i++) {
        dirs.push({ dx: tiles[i + 1]!.x - tiles[i]!.x, dy: tiles[i + 1]!.y - tiles[i]!.y });
    }
    return dirs;
}

/** Count occurrences of each unique direction in a step sequence. */
function countDirTypes(dirs: Dir[]): Array<Dir & { count: number }> {
    const types: Array<Dir & { count: number }> = [];
    for (const d of dirs) {
        const existing = types.find(t => t.dx === d.dx && t.dy === d.dy);
        if (existing) existing.count++;
        else types.push({ dx: d.dx, dy: d.dy, count: 1 });
    }
    return types;
}

/** Distribute two direction types into alternating runs of up to `runLen`. */
function interleaveRuns(a: Dir, countA: number, b: Dir, countB: number, startWithA: boolean, runLen: number): Dir[] {
    const result: Dir[] = [];
    let remainA = countA;
    let remainB = countB;
    let emitA = startWithA;

    while (remainA > 0 || remainB > 0) {
        const dir = emitA ? a : b;
        const remain = emitA ? remainA : remainB;

        if (remain > 0) {
            const run = Math.min(runLen, remain);
            for (let j = 0; j < run; j++) result.push({ dx: dir.dx, dy: dir.dy });
            if (emitA) remainA -= run;
            else remainB -= run;
        }

        emitA = !emitA;
    }
    return result;
}

/** Rebuild tile coordinates from a start point and a direction sequence. */
function rebuildTilesFromDirs(start: TileCoord, dirs: Dir[]): TileCoord[] {
    const result: TileCoord[] = [start];
    let { x, y } = start;
    for (const dir of dirs) {
        x += dir.dx;
        y += dir.dy;
        result.push({ x, y });
    }
    return result;
}

/**
 * Reorder tiles in a hex line to create same-direction runs of configurable length.
 *
 * The standard cube interpolation distributes direction changes maximally
 * evenly (e.g. E,SE,E,SE,E,SE). This function redistributes the steps into
 * runs of up to `_directionRunLength` (e.g. with length 3: E,E,E,SE,SE,SE).
 *
 * Any permutation of the same set of hex steps produces a valid path from
 * start to end, since each step is a valid hex direction move.
 *
 * @param tiles The raw hex line tiles
 * @param maxRunLength Override for the module-level setting (for testing)
 */
export function groupDirectionRuns(tiles: TileCoord[], maxRunLength?: number): TileCoord[] {
    const runLen = maxRunLength ?? _directionRunLength;
    if (tiles.length <= 2 || runLen <= 1) return tiles;

    const dirs = extractStepDirs(tiles);
    const dirTypes = countDirTypes(dirs);

    // Single direction or >2 directions — no regrouping needed
    if (dirTypes.length !== 2) return tiles;

    const a = dirTypes[0]!;
    const b = dirTypes[1]!;
    const startWithA = dirs[0]!.dx === a.dx && dirs[0]!.dy === a.dy;
    const grouped = interleaveRuns(a, a.count, b, b.count, startWithA, runLen);

    return rebuildTilesFromDirs(tiles[0]!, grouped);
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

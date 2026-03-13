/**
 * Line drawing utilities for the isometric diamond grid.
 *
 * Decomposes a displacement (dx, dy) into valid grid directions and
 * distributes them evenly using Bresenham-style interleaving, then
 * applies run-length grouping for visual smoothness.
 *
 * Valid grid directions (6 total):
 *   Edge-sharing:    (+1,0) E, (-1,0) W, (0,+1) SE, (0,-1) NW
 *   Vertex-sharing:  (+1,+1) NE, (-1,-1) SW
 *
 * Direction decomposition:
 *   Same-sign dx,dy → diagonal covers both axes → max(|dx|,|dy|) steps
 *   Different-sign   → axis-aligned only → |dx|+|dy| steps
 */

import { TileCoord } from '../../entity';

/**
 * Bresenham-style even interleave of two direction types.
 * Distributes `countA` steps of A and `countB` steps of B as evenly as possible.
 */
function evenInterleave(a: Dir, countA: number, b: Dir, countB: number): Dir[] {
    const total = countA + countB;
    if (total === 0) return [];
    if (countB === 0) return Array.from({ length: countA }, () => ({ dx: a.dx, dy: a.dy }));
    if (countA === 0) return Array.from({ length: countB }, () => ({ dx: b.dx, dy: b.dy }));

    const result: Dir[] = [];
    let emittedA = 0;
    for (let i = 0; i < total; i++) {
        // At step i, the ideal number of A steps emitted is countA*(i+1)/total
        const targetA = Math.round((countA * (i + 1)) / total);
        if (emittedA < targetA) {
            result.push({ dx: a.dx, dy: a.dy });
            emittedA++;
        } else {
            result.push({ dx: b.dx, dy: b.dy });
        }
    }
    return result;
}

/**
 * Generate all tiles along a grid line from (x1, y1) to (x2, y2).
 *
 * Decomposes the displacement into at most 2 valid direction types,
 * interleaves them evenly (Bresenham-style), then applies run-length
 * grouping to reduce visual zigzag.
 *
 * @returns Array of tile coordinates from start to end (inclusive)
 */
export function getHexLine(x1: number, y1: number, x2: number, y2: number): TileCoord[] {
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) {
        return [{ x: x1, y: y1 }];
    }

    let dirA: Dir, countA: number, dirB: Dir, countB: number;
    const sameSign = (dx >= 0 && dy >= 0) || (dx <= 0 && dy <= 0);

    if (sameSign) {
        // Diagonal (+1,+1) or (-1,-1) covers both axes simultaneously
        const sign = dx + dy >= 0 ? 1 : -1;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const diag = Math.min(absDx, absDy);

        dirA = { dx: sign, dy: sign };
        countA = diag;

        // Remaining steps along the longer axis
        if (absDx >= absDy) {
            dirB = { dx: sign, dy: 0 };
        } else {
            dirB = { dx: 0, dy: sign };
        }
        countB = Math.max(absDx, absDy) - diag;
    } else {
        // Different signs — no diagonal helps, use axis-aligned only
        dirA = { dx: dx > 0 ? 1 : -1, dy: 0 };
        countA = Math.abs(dx);
        dirB = { dx: 0, dy: dy > 0 ? 1 : -1 };
        countB = Math.abs(dy);
    }

    const dirs = evenInterleave(dirA, countA, dirB, countB);
    const tiles = rebuildTilesFromDirs({ x: x1, y: y1 }, dirs);

    return groupDirectionRuns(tiles);
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

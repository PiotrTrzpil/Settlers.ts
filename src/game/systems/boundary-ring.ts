/**
 * Isometric Boundary Ring Computation
 *
 * Shared algorithm for computing the boundary dot ring of an isometric circle.
 * Used by both territory rendering and work area visualization.
 *
 * Algorithm:
 *   1. Project tiles into screen space using the isometric transform with 0.7 vertical squash.
 *   2. Collect tiles inside the ellipse that have at least one hex neighbor outside it.
 *   3. Thin the raw boundary so dots form a single visual line (spatial hash dedup).
 */

import { GRID_DELTA_X, GRID_DELTA_Y, NUMBER_OF_DIRECTIONS } from './hex-directions';

// ── Isometric projection ──────────────────────────────────────────────

/** Vertical squash to match isometric perspective (tiles appear 30% shorter vertically). */
const Y_SCALE = 1.0 / 0.7;

/** Check if a tile offset (dx, dy) from center is inside the isometric ellipse. */
export function isInsideIsoEllipse(dx: number, dy: number, rSq: number): boolean {
    const sx = dx - dy * 0.5;
    const sy = dy * 0.5 * Y_SCALE;
    return sx * sx + sy * sy <= rSq;
}

// ── Screen-space thinning ─────────────────────────────────────────────

const MIN_DIST_SQ = 1.05;
const CELL_SIZE = 1.0;

function spatialCellKey(cx: number, cy: number): number {
    return cx * 100003 + cy;
}

function isTooClose(
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    grid: Map<number, { sx: number; sy: number }[]>
): boolean {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const bucket = grid.get(spatialCellKey(cx + dx, cy + dy));
            if (!bucket) continue;
            for (const p of bucket) {
                const dsx = sx - p.sx;
                const dsy = sy - p.sy;
                if (dsx * dsx + dsy * dsy < MIN_DIST_SQ) return true;
            }
        }
    }
    return false;
}

/** Minimum dot type — both TerritoryDot and WorkAreaDot satisfy this. */
export interface BoundaryDot {
    readonly x: number;
    readonly y: number;
    readonly player: number;
}

/**
 * Thin boundary dots in screen space so they form a single visual line.
 * Works on any dot type that has x/y coordinates.
 *
 * Tile (x,y) → screen (x − y*0.5, y*0.5). Uses a spatial hash to skip
 * dots that are too close to an already-accepted dot.
 */
export function thinDotsInScreenSpace<T extends BoundaryDot>(raw: T[]): T[] {
    const accepted: T[] = [];
    const grid = new Map<number, { sx: number; sy: number }[]>();

    for (const dot of raw) {
        const sx = dot.x - dot.y * 0.5;
        const sy = dot.y * 0.5;
        const cx = Math.floor(sx / CELL_SIZE);
        const cy = Math.floor(sy / CELL_SIZE);

        if (isTooClose(sx, sy, cx, cy, grid)) continue;

        accepted.push(dot);
        const key = spatialCellKey(cx, cy);
        let bucket = grid.get(key);
        if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
        }
        bucket.push({ sx, sy });
    }

    return accepted;
}

/**
 * Compute boundary dot positions for a single isometric circle.
 *
 * @param cx - Circle center X (tiles)
 * @param cy - Circle center Y (tiles)
 * @param radius - Radius in tiles
 * @param player - Player index for coloring
 * @param mapWidth - Map width for bounds clamping
 * @param mapHeight - Map height for bounds clamping
 */
export function computeCircleBoundaryDots(
    cx: number,
    cy: number,
    radius: number,
    player: number,
    mapWidth: number,
    mapHeight: number
): BoundaryDot[] {
    const screenR = radius * 0.5;
    const rSq = screenR * screenR;
    const raw: BoundaryDot[] = [];

    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(mapHeight - 1, cy + radius);
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(mapWidth - 1, cx + radius);

    for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        for (let x = minX; x <= maxX; x++) {
            const dx = x - cx;
            if (!isInsideIsoEllipse(dx, dy, rSq)) continue;
            if (hasBoundaryNeighbor(x, y, cx, cy, rSq, mapWidth, mapHeight)) {
                raw.push({ x, y, player });
            }
        }
    }

    return thinDotsInScreenSpace(raw);
}

/** Returns true if the tile has at least one hex neighbor outside the ellipse (or at map edge). */
function hasBoundaryNeighbor(
    x: number,
    y: number,
    cx: number,
    cy: number,
    rSq: number,
    mapWidth: number,
    mapHeight: number
): boolean {
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        const nx = x + GRID_DELTA_X[d]!;
        const ny = y + GRID_DELTA_Y[d]!;
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) return true;
        if (!isInsideIsoEllipse(nx - cx, ny - cy, rSq)) return true;
    }
    return false;
}

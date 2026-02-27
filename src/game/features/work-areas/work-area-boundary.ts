/**
 * Work Area Boundary Computation
 *
 * Computes boundary dots for a work area circle, using the same isometric
 * ellipse projection and screen-space thinning as the territory system.
 * The result is a ring of dot positions suitable for sprite rendering.
 */

import { GRID_DELTA_X, GRID_DELTA_Y, NUMBER_OF_DIRECTIONS } from '../../systems/hex-directions';

// ── Isometric ellipse test ───────────────────────────────────────────

/** Vertical squash factor to match isometric perspective (same as territory) */
const Y_SCALE = 1.0 / 0.7;

/** Check if a tile offset (dx, dy) from center is inside the isometric ellipse */
function isInsideEllipse(dx: number, dy: number, rSq: number): boolean {
    const sx = dx - dy * 0.5;
    const sy = dy * 0.5 * Y_SCALE;
    return sx * sx + sy * sy <= rSq;
}

// ── Screen-space thinning (matches territory-manager.ts) ─────────────

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

export interface WorkAreaDot {
    readonly x: number;
    readonly y: number;
    readonly player: number;
}

/** Check if a tile inside the ellipse has at least one hex neighbor outside it (or at map edge). */
function isBoundaryTile(
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
        if (!isInsideEllipse(nx - cx, ny - cy, rSq)) return true;
    }
    return false;
}

/**
 * Compute boundary dots for a single work area circle.
 *
 * Uses the same isometric ellipse projection as territory (vertical squash 0.7)
 * and hex-neighbor boundary detection + screen-space thinning.
 */
export function computeWorkAreaBoundaryDots(
    cx: number,
    cy: number,
    radius: number,
    player: number,
    mapWidth: number,
    mapHeight: number
): WorkAreaDot[] {
    const screenR = radius * 0.5;
    const rSq = screenR * screenR;
    const raw: WorkAreaDot[] = [];

    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(mapHeight - 1, cy + radius);
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(mapWidth - 1, cx + radius);

    for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        for (let x = minX; x <= maxX; x++) {
            const dx = x - cx;
            if (!isInsideEllipse(dx, dy, rSq)) continue;
            if (isBoundaryTile(x, y, cx, cy, rSq, mapWidth, mapHeight)) {
                raw.push({ x, y, player });
            }
        }
    }

    return thinDotsInScreenSpace(raw);
}

/** Thin dots in screen space so they form a single visual line (same as territory). */
function thinDotsInScreenSpace(raw: WorkAreaDot[]): WorkAreaDot[] {
    const accepted: WorkAreaDot[] = [];
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

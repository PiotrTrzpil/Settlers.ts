/**
 * Work Area Boundary Computation
 *
 * Computes evenly-spaced dot positions along isometric ellipses
 * for the work area ring visualization.
 */

import type { BoundaryDot } from '../../systems/boundary-ring';

export type WorkAreaDot = BoundaryDot;

/**
 * Territory dot sprite player indices for each ring color.
 * Maps to: TERRITORY_DOT_GREEN (1852), TERRITORY_DOT_YELLOW (1853), TERRITORY_DOT_RED (1850).
 */
const RING_PLAYER_INDICES = [2, 3, 0] as const; // inner=green, mid=yellow, outer=red

/** Vertical squash factor matching the isometric projection in boundary-ring.ts. */
const Y_SQUASH = 0.7;

/**
 * Compute evenly-spaced dots along an isometric ellipse.
 *
 * Walks parametrically around the screen-space circle at regular angular
 * intervals, converts back to tile coordinates, rounds to integers, and
 * deduplicates. This produces much more uniform spacing than the
 * boundary-detection + spatial-thinning approach.
 */
function computeEvenRingDots(
    cx: number,
    cy: number,
    radius: number,
    player: number,
    mapWidth: number,
    mapHeight: number
): WorkAreaDot[] {
    const screenR = radius * 0.5;
    // Enough samples that rounding still yields a dense, gap-free ring
    const numSamples = Math.max(36, Math.round(2 * Math.PI * screenR * 1.6));

    const seen = new Set<number>();
    const dots: WorkAreaDot[] = [];

    for (let i = 0; i < numSamples; i++) {
        const angle = (2 * Math.PI * i) / numSamples;
        const sx = screenR * Math.cos(angle);
        const sy = screenR * Math.sin(angle);

        // Inverse isometric: screen → tile offset
        const dy = sy * 2 * Y_SQUASH;
        const dx = sx + dy * 0.5;

        const x = Math.round(dx) + cx;
        const y = Math.round(dy) + cy;

        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;

        const key = y * mapWidth + x;
        if (seen.has(key)) continue;
        seen.add(key);

        dots.push({ x, y, player });
    }

    return dots;
}

/**
 * Compute 3 concentric colored rings for the work area visualization.
 * Uses territory dot color sprites: inner (green), mid (yellow), outer (red).
 * The outer ring matches the actual gameplay work area radius exactly.
 *
 * @param radius - Actual work area radius from building XML data
 */
export function computeWorkAreaColoredRings(
    cx: number,
    cy: number,
    radius: number,
    mapWidth: number,
    mapHeight: number
): WorkAreaDot[] {
    const ringRadii = [Math.round(radius / 3), Math.round((radius * 2) / 3), radius];
    const result: WorkAreaDot[] = [];
    for (let i = 0; i < ringRadii.length; i++) {
        const r = ringRadii[i]!;
        const playerIdx = RING_PLAYER_INDICES[i]!;
        const dots = computeEvenRingDots(cx, cy, r, playerIdx, mapWidth, mapHeight);
        for (const dot of dots) result.push(dot);
    }
    return result;
}

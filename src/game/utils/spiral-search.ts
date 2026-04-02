import type { Tile } from '@/game/core/coordinates';

/**
 * Spiral search from a center point outward.
 *
 * Iterates tile coordinates in expanding square perimeters (radius 0, 1, 2, …)
 * and returns the first coordinate where `predicate` returns true.
 *
 * @param cx - Center X coordinate
 * @param cy - Center Y coordinate
 * @param w - Map width (bounds check)
 * @param h - Map height (bounds check)
 * @param predicate - Returns true for the desired tile
 * @param maxRadius - Maximum search radius (default: half the larger dimension)
 * @returns The first matching coordinate, or null if none found
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- triple nested loops required for spiral traversal
export function spiralSearch(
    cx: number,
    cy: number,
    w: number,
    h: number,
    predicate: (x: number, y: number) => boolean,
    maxRadius?: number
): Tile | null {
    const limit = maxRadius ?? Math.ceil(Math.max(w, h) / 2);
    for (let r = 0; r < limit; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
                    continue;
                } // perimeter only
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || y < 0 || x >= w || y >= h) {
                    continue;
                }
                if (predicate(x, y)) {
                    return { x, y };
                }
            }
        }
    }
    return null;
}

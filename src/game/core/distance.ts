/**
 * Distance utilities — centralized squared-distance calculations.
 *
 * Use `distSq` for Euclidean proximity comparisons (avoids sqrt).
 * For hex-grid pathfinding distance, use `hexDistance` from systems/hex-directions.
 * For isometric screen-space distance, use `isoDistSq` from systems/boundary-ring.
 */

/** Squared Euclidean distance between two points. Use for proximity comparisons. */
export function distSq(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

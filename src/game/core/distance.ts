/**
 * Distance utilities — centralized squared-distance calculations.
 *
 * Use `distSq` for Euclidean proximity comparisons (avoids sqrt).
 * For hex-grid pathfinding distance, use `hexDistance` from systems/hex-directions.
 * For isometric screen-space distance, use `isoDistSq` from systems/boundary-ring.
 */

interface XY {
    readonly x: number;
    readonly y: number;
}

/** Squared Euclidean distance between two points. Use for proximity comparisons. */
export function distSq(a: XY, b: XY): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

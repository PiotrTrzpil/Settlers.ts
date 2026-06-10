/**
 * Tile iteration primitives: square ring perimeters and outward spirals.
 * Base module — depends only on core coordinate types.
 */

import { isInMapBounds, type Tile } from './coordinates';

/**
 * Generate the tiles on the perimeter of a square ring at the given radius
 * (Chebyshev distance) around `center`, in O(radius).
 *
 * Iteration order is column-major and part of the contract: left column
 * top-to-bottom, then each middle column's top and bottom tile left-to-right,
 * then the right column top-to-bottom. Several consumers break ties between
 * equidistant tiles by iteration order (spiralSearch first-match, findEmptySpot
 * RNG tiebreak), so changing the order changes deterministic game behavior.
 *
 * Tiles are NOT bounds-checked — callers filter with `isInMapBounds` as needed.
 */
export function* ringTiles(center: Tile, radius: number): Generator<Tile> {
    const { x: cx, y: cy } = center;

    if (radius === 0) {
        yield { x: cx, y: cy };
        return;
    }

    for (let dy = -radius; dy <= radius; dy++) {
        yield { x: cx - radius, y: cy + dy };
    }
    for (let dx = -radius + 1; dx <= radius - 1; dx++) {
        yield { x: cx + dx, y: cy - radius };
        yield { x: cx + dx, y: cy + radius };
    }
    for (let dy = -radius; dy <= radius; dy++) {
        yield { x: cx + radius, y: cy + dy };
    }
}

/**
 * A ring's perimeter contains no in-bounds tiles once the whole map rectangle
 * lies strictly inside the ring's hole — i.e. all four edges are outside the
 * map: top edge above, bottom edge below, left edge left of, right edge right
 * of the map.
 */
function isRingFullyOutOfBounds(center: Tile, radius: number, mapWidth: number, mapHeight: number): boolean {
    return (
        center.x - radius < 0 &&
        center.x + radius >= mapWidth &&
        center.y - radius < 0 &&
        center.y + radius >= mapHeight
    );
}

/**
 * Generate every in-bounds map tile in expanding square rings around `center`:
 * the center tile first, then full ring perimeters of increasing Chebyshev
 * distance. Terminates once a ring's perimeter lies entirely outside the map,
 * so iterating to exhaustion visits each map tile exactly once.
 */
export function* spiralTiles(center: Tile, mapWidth: number, mapHeight: number): Generator<Tile> {
    if (isInMapBounds(center, mapWidth, mapHeight)) {
        yield { x: center.x, y: center.y };
    }

    for (let radius = 1; !isRingFullyOutOfBounds(center, radius, mapWidth, mapHeight); radius++) {
        for (const tile of ringTiles(center, radius)) {
            if (isInMapBounds(tile, mapWidth, mapHeight)) {
                yield tile;
            }
        }
    }
}

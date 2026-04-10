/**
 * Tile search utilities — BFS and rectangular scan primitives.
 *
 * These centralize common search patterns used across features:
 * - `bfsFind`: BFS on the hex grid, returns first tile matching a predicate
 * - `scanRect`: Bounds-clamped rectangular tile iteration
 */

import { EXTENDED_OFFSETS, type Tile } from './coordinates';

// ─── BFS ────────────────────────────────────────────────────────

/** Offsets used by BFS. EXTENDED_OFFSETS gives the 6 reachable neighbors on the diamond grid. */
const BFS_OFFSETS = EXTENDED_OFFSETS;

/**
 * BFS search from a starting tile, returning the first tile where `goal` returns true.
 *
 * Expands outward through 6-directional neighbors (diamond grid). Tiles where
 * `passable` returns false are skipped (not expanded through). If `passable` is
 * omitted, all tiles are passable.
 *
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate
 * @param goal - Returns true for the desired tile (search stops immediately)
 * @param maxTiles - Maximum number of tiles to visit before giving up (default: 2000)
 * @param passable - Optional filter: only expand through tiles where this returns true.
 *                   The goal tile does NOT need to be passable — only expansion is gated.
 * @returns The first matching tile, or null if not found within maxTiles
 */
export function bfsFind(
    start: Tile,
    goal: (tile: Tile) => boolean,
    maxTiles = 2000,
    passable?: (tile: Tile) => boolean
): Tile | null {
    const visited = new Set<number>();
    const queue: Tile[] = [{ x: start.x, y: start.y }];
    visited.add(start.y * 10000 + start.x);

    for (let i = 0; i < queue.length && i < maxTiles; i++) {
        const tile = queue[i]!;
        if (goal(tile)) {
            return tile;
        }
        for (const [dx, dy] of BFS_OFFSETS) {
            const neighbor: Tile = { x: tile.x + dx, y: tile.y + dy };
            const key = neighbor.y * 10000 + neighbor.x;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            if (!passable || passable(neighbor)) {
                queue.push(neighbor);
            }
        }
    }
    return null;
}

// ─── Rectangular scan ───────────────────────────────────────────

/**
 * Iterate all tiles in a rectangular region clamped to map bounds.
 *
 * Calls `callback(x, y)` for every tile in the rectangle
 * `[cx - radius, cx + radius] × [cy - radius, cy + radius]`,
 * clamped to `[0, mapWidth-1] × [0, mapHeight-1]`.
 *
 * To stop early, return `true` from the callback.
 *
 * @returns true if the callback returned true (early exit), false otherwise.
 */
export function scanRect(
    center: Tile,
    radius: number,
    mapWidth: number,
    mapHeight: number,
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- void is intentional: callbacks that don't return early simply return nothing
    callback: (tile: Tile) => boolean | void
): boolean {
    const x0 = Math.max(0, center.x - radius);
    const x1 = Math.min(mapWidth - 1, center.x + radius);
    const y0 = Math.max(0, center.y - radius);
    const y1 = Math.min(mapHeight - 1, center.y + radius);

    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            if (callback({ x, y }) === true) {
                return true;
            }
        }
    }
    return false;
}

import { TileCoord, tileKey } from '../entity';
import { isPassable } from './placement';
import { GRID_DELTAS, NUMBER_OF_DIRECTIONS, hexDistance } from './hex-directions';

const MAX_SEARCH_NODES = 2000;

/**
 * Bucket queue for A* — O(1) insert, amortized O(1) popMin.
 * Nodes are grouped into buckets by integer floor of their cost.
 * On uniform-cost grids this is significantly faster than a binary heap.
 */
class BucketPriorityQueue {
    private buckets: number[][] = [];
    private minBucket = 0;
    private _size = 0;

    get size(): number {
        return this._size;
    }

    insert(nodeId: number, cost: number): void {
        const bucketIndex = Math.max(0, Math.floor(cost));
        // Ensure capacity
        while (this.buckets.length <= bucketIndex) {
            this.buckets.push([]);
        }
        this.buckets[bucketIndex].push(nodeId);
        if (bucketIndex < this.minBucket) {
            this.minBucket = bucketIndex;
        }
        this._size++;
    }

    popMin(): number {
        while (this.minBucket < this.buckets.length && this.buckets[this.minBucket].length === 0) {
            this.minBucket++;
        }
        this._size--;
        return this.buckets[this.minBucket].pop()!;
    }
}

/**
 * A* pathfinding on the hex tile grid.
 *
 * Uses 6-directional movement (hex grid neighbors).
 * Cost = 1 + abs(heightDiff). Impassable tiles block movement.
 * Uses bucket queue for O(1) insert and amortized O(1) extract-min.
 * Uses flat arrays for costs and bitset-style tracking for open/closed sets.
 *
 * Returns array of waypoints from start (exclusive) to goal (inclusive),
 * or null if no path found.
 */
export function findPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): TileCoord[] | null {
    if (startX === goalX && startY === goalY) {
        return [];
    }

    // Check goal is passable
    const goalIdx = goalX + goalY * mapWidth;
    if (!isPassable(groundType[goalIdx])) {
        return null;
    }

    const totalTiles = mapWidth * mapHeight;

    // Flat arrays for costs — Float32Array avoids Map overhead
    const gCost = new Float32Array(totalTiles);
    gCost.fill(Infinity);

    // Parent tracking — integer index, -1 = no parent
    const parent = new Int32Array(totalTiles);
    parent.fill(-1);

    // Bitset-style open/closed tracking using Uint8Array
    // Bit 0 = in open set, Bit 1 = in closed set
    const flags = new Uint8Array(totalTiles);
    const FLAG_OPEN = 1;
    const FLAG_CLOSED = 2;

    const openQueue = new BucketPriorityQueue();

    const startIdx = startX + startY * mapWidth;
    const startH = hexDistance(startX, startY, goalX, goalY);
    gCost[startIdx] = 0;
    flags[startIdx] = FLAG_OPEN;
    openQueue.insert(startIdx, startH);

    let nodesSearched = 0;

    while (openQueue.size > 0 && nodesSearched < MAX_SEARCH_NODES) {
        const currentIdx = openQueue.popMin();

        // Skip if already closed (bucket queue may have stale entries)
        if (flags[currentIdx] & FLAG_CLOSED) continue;
        flags[currentIdx] = FLAG_CLOSED;
        nodesSearched++;

        const cx = currentIdx % mapWidth;
        const cy = (currentIdx - cx) / mapWidth;

        // Goal check
        if (cx === goalX && cy === goalY) {
            return reconstructPathFromArrays(currentIdx, parent, mapWidth);
        }

        const currentG = gCost[currentIdx];
        const currentHeight = groundHeight[currentIdx];

        // Expand all 6 hex neighbors
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            const [dx, dy] = GRID_DELTAS[d];
            const nx = cx + dx;
            const ny = cy + dy;

            // Bounds check
            if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) {
                continue;
            }

            const nIdx = nx + ny * mapWidth;

            // Skip if already closed
            if (flags[nIdx] & FLAG_CLOSED) continue;

            // Check passability
            if (!isPassable(groundType[nIdx])) continue;

            // Don't path through occupied tiles (except the goal)
            if (nx !== goalX || ny !== goalY) {
                if (tileOccupancy.has(tileKey(nx, ny))) {
                    continue;
                }
            }

            // Cost: base 1 + height difference penalty
            const neighborHeight = groundHeight[nIdx];
            const heightDiff = Math.abs(currentHeight - neighborHeight);
            const moveCost = 1 + heightDiff;

            const tentativeG = currentG + moveCost;

            if (tentativeG < gCost[nIdx]) {
                gCost[nIdx] = tentativeG;
                parent[nIdx] = currentIdx;
                flags[nIdx] |= FLAG_OPEN;
                const h = hexDistance(nx, ny, goalX, goalY);
                openQueue.insert(nIdx, tentativeG + h);
            }
        }
    }

    return null; // No path found
}

/**
 * Reconstruct path from flat parent array.
 * Returns waypoints from start (exclusive) to goal (inclusive).
 */
function reconstructPathFromArrays(
    goalIdx: number,
    parent: Int32Array,
    mapWidth: number,
): TileCoord[] {
    const path: TileCoord[] = [];
    let idx = goalIdx;

    while (parent[idx] !== -1) {
        const x = idx % mapWidth;
        const y = (idx - x) / mapWidth;
        path.push({ x, y });
        idx = parent[idx];
    }

    path.reverse();
    return path;
}

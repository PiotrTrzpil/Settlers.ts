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

const FLAG_OPEN = 1;
const FLAG_CLOSED = 2;

interface PathContext {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapWidth: number;
    mapHeight: number;
    goalX: number;
    goalY: number;
    tileOccupancy: Map<string, number>;
    gCost: Float32Array;
    parent: Int32Array;
    flags: Uint8Array;
    openQueue: BucketPriorityQueue;
}

/** Check if a neighbor tile can be entered */
function canEnterTile(
    nx: number, ny: number, nIdx: number,
    ctx: PathContext
): boolean {
    if (ctx.flags[nIdx] & FLAG_CLOSED) return false;
    if (!isPassable(ctx.groundType[nIdx])) return false;

    // Allow entering the goal even if occupied
    const isGoal = nx === ctx.goalX && ny === ctx.goalY;
    if (!isGoal && ctx.tileOccupancy.has(tileKey(nx, ny))) return false;

    return true;
}

/** Process a single neighbor in the A* expansion */
function processNeighbor(
    cx: number, cy: number, currentIdx: number, d: number,
    ctx: PathContext
): void {
    const [dx, dy] = GRID_DELTAS[d];
    const nx = cx + dx;
    const ny = cy + dy;

    if (nx < 0 || nx >= ctx.mapWidth || ny < 0 || ny >= ctx.mapHeight) return;

    const nIdx = nx + ny * ctx.mapWidth;
    if (!canEnterTile(nx, ny, nIdx, ctx)) return;

    const currentHeight = ctx.groundHeight[currentIdx];
    const neighborHeight = ctx.groundHeight[nIdx];
    const moveCost = 1 + Math.abs(currentHeight - neighborHeight);
    const tentativeG = ctx.gCost[currentIdx] + moveCost;

    if (tentativeG < ctx.gCost[nIdx]) {
        ctx.gCost[nIdx] = tentativeG;
        ctx.parent[nIdx] = currentIdx;
        ctx.flags[nIdx] |= FLAG_OPEN;
        const h = hexDistance(nx, ny, ctx.goalX, ctx.goalY);
        ctx.openQueue.insert(nIdx, tentativeG + h);
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
    if (startX === goalX && startY === goalY) return [];

    const goalIdx = goalX + goalY * mapWidth;
    if (!isPassable(groundType[goalIdx])) return null;

    const totalTiles = mapWidth * mapHeight;
    const gCost = new Float32Array(totalTiles);
    gCost.fill(Infinity);

    const parent = new Int32Array(totalTiles);
    parent.fill(-1);

    const flags = new Uint8Array(totalTiles);
    const openQueue = new BucketPriorityQueue();

    const ctx: PathContext = {
        groundType, groundHeight, mapWidth, mapHeight,
        goalX, goalY, tileOccupancy, gCost, parent, flags, openQueue
    };

    const startIdx = startX + startY * mapWidth;
    gCost[startIdx] = 0;
    flags[startIdx] = FLAG_OPEN;
    openQueue.insert(startIdx, hexDistance(startX, startY, goalX, goalY));

    let nodesSearched = 0;

    while (openQueue.size > 0 && nodesSearched < MAX_SEARCH_NODES) {
        const currentIdx = openQueue.popMin();

        if (flags[currentIdx] & FLAG_CLOSED) continue;
        flags[currentIdx] = FLAG_CLOSED;
        nodesSearched++;

        const cx = currentIdx % mapWidth;
        const cy = (currentIdx - cx) / mapWidth;

        if (cx === goalX && cy === goalY) {
            return reconstructPathFromArrays(currentIdx, parent, mapWidth);
        }

        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            processNeighbor(cx, cy, currentIdx, d, ctx);
        }
    }

    return null;
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

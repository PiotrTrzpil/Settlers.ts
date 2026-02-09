/**
 * A* Pathfinding Algorithm for Hex Grids.
 *
 * This module provides the core A* implementation optimized for hex grids
 * with uniform movement costs. Key features:
 *
 * - Uses bucket priority queue for O(1) operations on uniform-cost grids
 * - Hex-aware heuristic (cube coordinate distance)
 * - Tie-breaking to prevent zigzag paths
 * - Path smoothing post-processing
 *
 * Usage:
 *   const path = findPath(startX, startY, goalX, goalY, terrain);
 *   // Returns array of waypoints from start (exclusive) to goal (inclusive)
 */

import { tileKey, TileCoord } from '../../entity';
import { isPassable } from '../../features/placement';
import { GRID_DELTAS, NUMBER_OF_DIRECTIONS, hexDistance, getApproxDirection } from '../hex-directions';
import { BucketPriorityQueue } from './bucket-priority-queue';
import { smoothPath } from './path-smoothing';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum nodes to search before giving up (prevents runaway on large maps) */
const MAX_SEARCH_NODES = 2000;

/** Cost multiplier for integer arithmetic (10 = 0.1 precision) */
const COST_SCALE = 10;

/** Base movement cost per tile (uniform for Settlers-style games) */
const MOVE_COST = 10;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Bit flags for node state tracking */
const FLAG_OPEN = 1;
const FLAG_CLOSED = 2;

/**
 * Terrain information needed for pathfinding.
 */
export interface TerrainData {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapWidth: number;
    mapHeight: number;
}

/**
 * Internal context for A* search.
 * Grouped to reduce parameter passing overhead.
 */
interface SearchContext {
    terrain: TerrainData;
    goalX: number;
    goalY: number;
    tileOccupancy: Map<string, number>;
    ignoreOccupancy: boolean;
    gCost: Float32Array;
    parent: Int32Array;
    flags: Uint8Array;
    openQueue: BucketPriorityQueue;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE A* IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a tile can be entered.
 */
function canEnterTile(
    nx: number, ny: number, nIdx: number,
    ctx: SearchContext
): boolean {
    // Already processed?
    if (ctx.flags[nIdx] & FLAG_CLOSED) return false;

    // Impassable terrain?
    if (!isPassable(ctx.terrain.groundType[nIdx])) return false;

    // Occupied by another unit? (allow goal tile even if occupied)
    const isGoal = nx === ctx.goalX && ny === ctx.goalY;
    if (!ctx.ignoreOccupancy && !isGoal && ctx.tileOccupancy.has(tileKey(nx, ny))) {
        return false;
    }

    return true;
}

/**
 * Compute the priority for a node (f = g + h + tie-breaker).
 */
function computePriority(
    nx: number, ny: number,
    gCost: number,
    direction: number,
    ctx: SearchContext
): number {
    // Heuristic: hex distance scaled to match movement cost
    const h = hexDistance(nx, ny, ctx.goalX, ctx.goalY) * COST_SCALE;

    // Tie-breaker 1: A* epsilon - slightly inflate h to prefer shorter paths
    const epsilon = 0.001;
    const epsilonTieBreaker = h * epsilon;

    // Tie-breaker 2: Prefer moves aligned with goal direction
    const targetDir = getApproxDirection(nx, ny, ctx.goalX, ctx.goalY);
    let dirDiff = Math.abs(direction - targetDir);
    if (dirDiff > 3) dirDiff = 6 - dirDiff;
    const directionPenalty = dirDiff * 0.1;

    return gCost + h + epsilonTieBreaker + directionPenalty;
}

/**
 * Process a single neighbor during A* expansion.
 */
function processNeighbor(
    cx: number, cy: number, currentIdx: number,
    direction: number,
    ctx: SearchContext
): void {
    const [dx, dy] = GRID_DELTAS[direction];
    const nx = cx + dx;
    const ny = cy + dy;

    // Bounds check
    const { mapWidth, mapHeight } = ctx.terrain;
    if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) return;

    const nIdx = nx + ny * mapWidth;

    // Passability check
    if (!canEnterTile(nx, ny, nIdx, ctx)) return;

    // Compute tentative g-cost
    const tentativeG = ctx.gCost[currentIdx] + MOVE_COST;

    // Only update if this is a better path
    if (tentativeG < ctx.gCost[nIdx]) {
        ctx.gCost[nIdx] = tentativeG;
        ctx.parent[nIdx] = currentIdx;
        ctx.flags[nIdx] |= FLAG_OPEN;

        const priority = computePriority(nx, ny, tentativeG, direction, ctx);
        ctx.openQueue.insert(nIdx, priority);
    }
}

/**
 * Reconstruct path from parent array.
 * Returns waypoints from start (exclusive) to goal (inclusive).
 */
function reconstructPath(
    goalIdx: number,
    parent: Int32Array,
    mapWidth: number
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

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find a path from start to goal on a hex grid.
 *
 * Uses A* with hex distance heuristic and bucket priority queue.
 * Applies path smoothing to remove unnecessary zigzags.
 *
 * @param startX Starting tile X coordinate
 * @param startY Starting tile Y coordinate
 * @param goalX Goal tile X coordinate
 * @param goalY Goal tile Y coordinate
 * @param terrain Terrain data (ground type, height, dimensions)
 * @param tileOccupancy Map of occupied tiles
 * @param ignoreOccupancy If true, ignore unit occupancy (for planning)
 * @returns Array of waypoints from start (exclusive) to goal (inclusive), or null if no path
 */
export function findPathAStar(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    terrain: TerrainData,
    tileOccupancy: Map<string, number>,
    ignoreOccupancy: boolean = false
): TileCoord[] | null {
    // Trivial case: already at goal
    if (startX === goalX && startY === goalY) {
        return [];
    }

    // Check if goal is reachable at all
    const { mapWidth, mapHeight, groundType } = terrain;
    const goalIdx = goalX + goalY * mapWidth;
    if (!isPassable(groundType[goalIdx])) {
        return null;
    }

    // Initialize search data structures
    const totalTiles = mapWidth * mapHeight;
    const gCost = new Float32Array(totalTiles);
    gCost.fill(Infinity);

    const parent = new Int32Array(totalTiles);
    parent.fill(-1);

    const flags = new Uint8Array(totalTiles);
    const openQueue = new BucketPriorityQueue();

    const ctx: SearchContext = {
        terrain,
        goalX, goalY,
        tileOccupancy,
        ignoreOccupancy,
        gCost, parent, flags, openQueue
    };

    // Initialize start node
    const startIdx = startX + startY * mapWidth;
    gCost[startIdx] = 0;
    flags[startIdx] = FLAG_OPEN;
    openQueue.insert(startIdx, hexDistance(startX, startY, goalX, goalY) * COST_SCALE);

    // A* main loop
    let nodesSearched = 0;

    while (!openQueue.isEmpty && nodesSearched < MAX_SEARCH_NODES) {
        const currentIdx = openQueue.popMin();

        // Skip if already processed (can happen with duplicate insertions)
        if (flags[currentIdx] & FLAG_CLOSED) continue;
        flags[currentIdx] = FLAG_CLOSED;
        nodesSearched++;

        // Convert index to coordinates
        const cx = currentIdx % mapWidth;
        const cy = (currentIdx - cx) / mapWidth;

        // Goal reached?
        if (cx === goalX && cy === goalY) {
            const rawPath = reconstructPath(currentIdx, parent, mapWidth);

            // Apply path smoothing
            return smoothPath(rawPath, startX, startY, {
                groundType,
                mapWidth,
                mapHeight,
                tileOccupancy,
                ignoreOccupancy
            });
        }

        // Expand neighbors
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            processNeighbor(cx, cy, currentIdx, d, ctx);
        }
    }

    // No path found
    return null;
}

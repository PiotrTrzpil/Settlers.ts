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
import { isPassable } from '../../terrain';
import { GRID_DELTAS, NUMBER_OF_DIRECTIONS, hexDistance, getApproxDirection } from '../hex-directions';
import { BucketPriorityQueue } from './bucket-priority-queue';
import { smoothPath } from './path-smoothing';

// ═══════════════════════════════════════════════════════════════════════════
// REUSABLE BUFFERS (avoid per-call TypedArray allocation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Module-level buffers reused across all findPathAStar calls.
 * JavaScript is single-threaded so this is safe. Each call reset via fill()
 * which is an order of magnitude cheaper than allocation + GC.
 */
let _bufferSize = 0;
let _gCost = new Float32Array(0);
let _parent = new Int32Array(0);
let _flags = new Uint8Array(0);
/** Integer-indexed building occupancy bitmap — avoids tileKey string creation in hot loop. */
let _buildingBitmap = new Uint8Array(0);
const _openQueue = new BucketPriorityQueue();

/**
 * Clear the building bitmap for the building surrounding a tile.
 * Clears the tile itself and all immediate neighbors belonging to the same building,
 * creating a one-ring "tunnel" that lets the path enter or exit through the footprint.
 */
function clearBuildingTunnelFromBitmap(
    x: number,
    y: number,
    buildingId: number,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): void {
    _buildingBitmap[x + y * mapWidth] = 0;
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        const [dx, dy] = GRID_DELTAS[d]!;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;
        const nIdx = nx + ny * mapWidth;
        if (_buildingBitmap[nIdx] && tileOccupancy.get(tileKey(nx, ny)) === buildingId) {
            _buildingBitmap[nIdx] = 0;
        }
    }
}

/**
 * Find the building entity that owns the footprint around the start tile.
 * Checks neighbors first because the start tile itself may hold a unit (the mover), not the building.
 */
function findStartBuildingId(
    startX: number,
    startY: number,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): number | undefined {
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        const [dx, dy] = GRID_DELTAS[d]!;
        const nx = startX + dx;
        const ny = startY + dy;
        if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;
        if (!_buildingBitmap[nx + ny * mapWidth]) continue;
        const occupant = tileOccupancy.get(tileKey(nx, ny));
        if (occupant !== undefined) return occupant;
    }
    return undefined;
}

/**
 * Find the building entity that owns the goal tile.
 * Checks the goal tile itself first (no unit will be there), then falls back to neighbors.
 */
function findGoalBuildingId(
    goalX: number,
    goalY: number,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): number | undefined {
    const direct = tileOccupancy.get(tileKey(goalX, goalY));
    if (direct !== undefined) return direct;
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        const [dx, dy] = GRID_DELTAS[d]!;
        const nx = goalX + dx;
        const ny = goalY + dy;
        if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;
        if (!_buildingBitmap[nx + ny * mapWidth]) continue;
        const occupant = tileOccupancy.get(tileKey(nx, ny));
        if (occupant !== undefined) return occupant;
    }
    return undefined;
}

/**
 * If the start tile is inside a building, clear that building's immediate tiles from the bitmap
 * so the unit can walk out (exit tunnel).
 */
function tryCreateExitTunnel(
    x: number,
    y: number,
    idx: number,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): void {
    if (!_buildingBitmap[idx]) return;
    const buildingId = findStartBuildingId(x, y, mapWidth, mapHeight, tileOccupancy);
    if (buildingId !== undefined) clearBuildingTunnelFromBitmap(x, y, buildingId, mapWidth, mapHeight, tileOccupancy);
}

/**
 * If the goal tile is inside a building, clear that building's immediate tiles from the bitmap
 * so the unit can path in (entry tunnel — e.g. worker returning to workplace door).
 */
function tryCreateEntryTunnel(
    x: number,
    y: number,
    idx: number,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): void {
    if (!_buildingBitmap[idx]) return;
    const buildingId = findGoalBuildingId(x, y, mapWidth, mapHeight, tileOccupancy);
    if (buildingId !== undefined) clearBuildingTunnelFromBitmap(x, y, buildingId, mapWidth, mapHeight, tileOccupancy);
}

function prepareBuffers(totalTiles: number): void {
    if (totalTiles > _bufferSize) {
        _gCost = new Float32Array(totalTiles);
        _parent = new Int32Array(totalTiles);
        _flags = new Uint8Array(totalTiles);
        _buildingBitmap = new Uint8Array(totalTiles);
        _bufferSize = totalTiles;
    }
    _gCost.fill(Infinity, 0, totalTiles);
    _parent.fill(-1, 0, totalTiles);
    _flags.fill(0, 0, totalTiles);
    _openQueue.clear();
}

/** Snapshot the string-keyed building occupancy Set into the integer-indexed bitmap. */
function populateBuildingBitmap(buildingOccupancy: Set<string>, mapWidth: number, totalTiles: number): void {
    _buildingBitmap.fill(0, 0, totalTiles);
    for (const key of buildingOccupancy) {
        const comma = key.indexOf(',');
        const x = +key.slice(0, comma);
        const y = +key.slice(comma + 1);
        const idx = x + y * mapWidth;
        if (idx >= 0 && idx < totalTiles) {
            _buildingBitmap[idx] = 1;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum nodes to search before giving up (prevents runaway on large maps).
 *  Needs to be high enough to route around building footprints in dense settlements. */
const MAX_SEARCH_NODES = 50_000;

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
export interface PathfindingTerrain {
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
    terrain: PathfindingTerrain;
    goalX: number;
    goalY: number;
    goalIdx: number;
    buildingBitmap: Uint8Array;
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
 * Only considers terrain passability and building footprints — unit occupancy is ignored
 * (collisions are resolved at movement time via bump-or-wait).
 */
function canEnterTile(_nx: number, _ny: number, nIdx: number, ctx: SearchContext): boolean {
    // Already processed?
    if (ctx.flags[nIdx]! & FLAG_CLOSED) return false;

    // Impassable terrain?
    if (!isPassable(ctx.terrain.groundType[nIdx]!)) return false;

    // Goal tile is always enterable (for building interaction / final position)
    if (nIdx === ctx.goalIdx) return true;

    // Building footprints block — integer-indexed bitmap (no string creation)
    if (ctx.buildingBitmap[nIdx]) return false;

    return true;
}

/**
 * Compute the priority for a node (f = g + h + tie-breaker).
 *
 * @param cx Current X (where we're coming from)
 * @param cy Current Y (where we're coming from)
 * @param nx Neighbor X (where we're going)
 * @param ny Neighbor Y (where we're going)
 * @param gCost Cost to reach neighbor
 * @param direction Direction of move (0-5)
 * @param ctx Search context
 */
function computePriority(
    cx: number,
    cy: number,
    nx: number,
    ny: number,
    gCost: number,
    direction: number,
    ctx: SearchContext
): number {
    // Heuristic: hex distance scaled to match movement cost
    const h = hexDistance(nx, ny, ctx.goalX, ctx.goalY) * COST_SCALE;

    // Tie-breaker: Prefer moves aligned with goal direction.
    // Must be >= 1 to affect bucket priority queue assignment (integer floors).
    // Range 0-6 vs MOVE_COST=10 gives meaningful guidance without bad paths.
    const targetDir = getApproxDirection(cx, cy, ctx.goalX, ctx.goalY);
    let dirDiff = Math.abs(direction - targetDir);
    if (dirDiff > 3) dirDiff = 6 - dirDiff;
    const directionPenalty = dirDiff * 2;

    return gCost + h + directionPenalty;
}

/**
 * Process a single neighbor during A* expansion.
 */
function processNeighbor(cx: number, cy: number, currentIdx: number, direction: number, ctx: SearchContext): void {
    const [dx, dy] = GRID_DELTAS[direction]!;
    const nx = cx + dx;
    const ny = cy + dy;

    // Bounds check
    const { mapWidth, mapHeight } = ctx.terrain;
    if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) return;

    const nIdx = nx + ny * mapWidth;

    // Passability check
    if (!canEnterTile(nx, ny, nIdx, ctx)) return;

    // Compute tentative g-cost
    const tentativeG = ctx.gCost[currentIdx]! + MOVE_COST;

    // Only update if this is a better path
    if (tentativeG < ctx.gCost[nIdx]!) {
        ctx.gCost[nIdx] = tentativeG;
        ctx.parent[nIdx] = currentIdx;
        ctx.flags[nIdx]! |= FLAG_OPEN;

        const priority = computePriority(cx, cy, nx, ny, tentativeG, direction, ctx);
        ctx.openQueue.insert(nIdx, priority);
    }
}

/**
 * Reconstruct path from parent array.
 * Returns waypoints from start (exclusive) to goal (inclusive).
 */
function reconstructPath(goalIdx: number, parent: Int32Array, mapWidth: number): TileCoord[] {
    const path: TileCoord[] = [];
    let idx = goalIdx;

    while (parent[idx]! !== -1) {
        const x = idx % mapWidth;
        const y = (idx - x) / mapWidth;
        path.push({ x, y });
        idx = parent[idx]!;
    }

    path.reverse();
    return path;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

/** Optional hook to resolve entity IDs to human-readable descriptions (e.g. "Carrier", "Woodcutter", "WoodcutterHut"). */
let _describeEntity: ((entityId: number) => string) | undefined;

/** Register a callback that resolves entity IDs to descriptive names for A* diagnostic logs. */
export function setEntityDescriber(fn: (entityId: number) => string): void {
    _describeEntity = fn;
}

/** Format an entity reference: "id(Type)" if describer is set, otherwise just "id". */
function entityTag(entityId: number): string {
    if (!_describeEntity) return String(entityId);
    return entityId + '(' + _describeEntity(entityId) + ')';
}

/** Diagnose why a single neighbor was rejected. */
function diagnoseNeighbor(
    d: number,
    startX: number,
    startY: number,
    groundType: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): string {
    const [dx, dy] = GRID_DELTAS[d]!;
    const nx = startX + dx;
    const ny = startY + dy;
    const pos = `d${d}(${nx},${ny})`;
    if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) return pos + ':OOB';
    const nIdx = nx + ny * mapWidth;
    if (!isPassable(groundType[nIdx]!)) return pos + ':terrain';
    if (_buildingBitmap[nIdx]) {
        const occupant = tileOccupancy.get(tileKey(nx, ny));
        return pos + ':building' + (occupant !== undefined ? '[' + entityTag(occupant) + ']' : '');
    }
    return pos + ':closed';
}

/** Log detailed diagnostic info when pathfinding fails. */
function logPathfindingFailure(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    startIdx: number,
    goalIdx: number,
    nodesSearched: number,
    groundType: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>,
    buildingOccupancy: Set<string>
): void {
    const startKey = tileKey(startX, startY);
    const goalKey = tileKey(goalX, goalY);
    const startInBuilding = buildingOccupancy.has(startKey);
    const goalInBuilding = buildingOccupancy.has(goalKey);
    const startPassable = isPassable(groundType[startIdx]!);
    const goalPassable = isPassable(groundType[goalIdx]!);
    const exhausted = nodesSearched >= MAX_SEARCH_NODES;
    const startOccupant = tileOccupancy.get(startKey);

    let neighborInfo = '';
    if (nodesSearched <= 1) {
        const reasons: string[] = [];
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            reasons.push(diagnoseNeighbor(d, startX, startY, groundType, mapWidth, mapHeight, tileOccupancy));
        }
        neighborInfo = ' neighbors=[' + reasons.join(', ') + ']';
    }

    const occupantTag = startOccupant !== undefined ? ', occupant=' + entityTag(startOccupant) : '';
    console.warn(
        `[A*] No path (${startX},${startY})->(${goalX},${goalY}): ` +
            `searched=${nodesSearched}/${MAX_SEARCH_NODES} ${exhausted ? 'EXHAUSTED' : 'EMPTY_QUEUE'} ` +
            `start[passable=${startPassable}, inBuilding=${startInBuilding}${occupantTag}] ` +
            `goal[passable=${goalPassable}, inBuilding=${goalInBuilding}]${neighborInfo}`
    );
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
 * A* only considers terrain and building footprints for blocking — unit occupancy
 * is ignored. Collisions with other units are resolved at movement time via bump-or-wait.
 *
 * @param startX Starting tile X coordinate
 * @param startY Starting tile Y coordinate
 * @param goalX Goal tile X coordinate
 * @param goalY Goal tile Y coordinate
 * @param terrain Terrain data (ground type, height, dimensions)
 * @param tileOccupancy Map of occupied tiles (used only for building tunnel identification)
 * @param buildingOccupancy Set of tiles occupied by building footprints
 * @returns Array of waypoints from start (exclusive) to goal (inclusive), or null if no path
 */
export function findPathAStar(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    terrain: PathfindingTerrain,
    tileOccupancy: Map<string, number>,
    buildingOccupancy: Set<string>
): TileCoord[] | null {
    // Trivial case: already at goal
    if (startX === goalX && startY === goalY) {
        return [];
    }

    // Check if goal is reachable at all
    const { mapWidth, mapHeight, groundType } = terrain;
    const goalIdx = goalX + goalY * mapWidth;
    if (!isPassable(groundType[goalIdx]!)) {
        return null;
    }

    // Prepare reusable buffers (fill-reset is far cheaper than per-call allocation)
    const totalTiles = mapWidth * mapHeight;
    prepareBuffers(totalTiles);
    populateBuildingBitmap(buildingOccupancy, mapWidth, totalTiles);
    const gCost = _gCost;
    const parent = _parent;
    const flags = _flags;
    const openQueue = _openQueue;

    const ctx: SearchContext = {
        terrain,
        goalX,
        goalY,
        goalIdx,
        buildingBitmap: _buildingBitmap,
        gCost,
        parent,
        flags,
        openQueue,
    };

    // Initialize start node
    const startIdx = startX + startY * mapWidth;

    // If start or goal is inside a building footprint, create a local tunnel so the path
    // can exit (start inside = worker leaving workplace) or enter (goal inside = worker
    // returning to workplace door).
    tryCreateExitTunnel(startX, startY, startIdx, mapWidth, mapHeight, tileOccupancy);
    tryCreateEntryTunnel(goalX, goalY, goalIdx, mapWidth, mapHeight, tileOccupancy);

    gCost[startIdx] = 0;
    flags[startIdx] = FLAG_OPEN;
    openQueue.insert(startIdx, hexDistance(startX, startY, goalX, goalY) * COST_SCALE);

    // A* main loop
    let nodesSearched = 0;

    while (!openQueue.isEmpty && nodesSearched < MAX_SEARCH_NODES) {
        const currentIdx = openQueue.popMin();

        // Skip if already processed (can happen with duplicate insertions)
        if (flags[currentIdx]! & FLAG_CLOSED) continue;
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
                buildingOccupancy,
            });
        }

        // Expand neighbors
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            processNeighbor(cx, cy, currentIdx, d, ctx);
        }
    }

    logPathfindingFailure(
        startX,
        startY,
        goalX,
        goalY,
        startIdx,
        goalIdx,
        nodesSearched,
        groundType,
        mapWidth,
        mapHeight,
        tileOccupancy,
        buildingOccupancy
    );
    return null;
}

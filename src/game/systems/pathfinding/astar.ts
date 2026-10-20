/**
 * A* pathfinding on the isometric diamond grid.
 *
 * Uniform-cost search with a bucket priority queue, hex-distance heuristic,
 * and a direction-alignment tie-breaker. Path smoothing removes zigzags
 * after the search. Units never block — collisions are resolved at movement time.
 */

import { tileKey, isInMapBounds, type Tile } from '../../core/coordinates';
import { isPassable } from '../../terrain';
import { GRID_DELTAS, NUMBER_OF_DIRECTIONS, hexDistance, getDirectionToward } from '../hex-directions';
import { BucketPriorityQueue } from './bucket-priority-queue';
import { smoothPath } from './path-smoothing';

// ═══════════════════════════════════════════════════════════════════════════
// Reusable buffers (JS is single-threaded — fill-reset beats alloc + GC)
// ═══════════════════════════════════════════════════════════════════════════

let _bufferSize = 0;
let _gCost = new Float32Array(0);
let _parent = new Int32Array(0);
let _flags = new Uint8Array(0);
/** Integer-indexed building occupancy — avoids tileKey strings in the hot loop. */
let _buildingBitmap = new Uint8Array(0);
const _openQueue = new BucketPriorityQueue();

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

const MAX_SEARCH_NODES = 50_000;
const COST_SCALE = 10;
const MOVE_COST = 10;
const FLAG_OPEN = 1;
const FLAG_CLOSED = 2;

export interface PathfindingTerrain {
    groundType: Uint8Array;
    mapWidth: number;
    mapHeight: number;
}

export interface PathfindingFailureInfo {
    startPassable: boolean;
    goalPassable: boolean;
    startInBuilding: boolean;
    goalInBuilding: boolean;
    nodesSearched: number;
    exhausted: boolean;
    neighborInfo: string;
}

export type PathFindResult = { ok: true; path: Tile[] } | { ok: false; failure: PathfindingFailureInfo };

interface SearchContext {
    terrain: PathfindingTerrain;
    goal: Tile;
    goalIdx: number;
    gCost: Float32Array;
    parent: Int32Array;
    flags: Uint8Array;
    openQueue: BucketPriorityQueue;
}

function tileIndex(tile: Tile, mapWidth: number): number {
    return tile.x + tile.y * mapWidth;
}

function canEnterTile(nIdx: number, ctx: SearchContext): boolean {
    if (ctx.flags[nIdx]! & FLAG_CLOSED) {
        return false;
    }
    if (!isPassable(ctx.terrain.groundType[nIdx]!)) {
        return false;
    }
    // Goal is always enterable (doors / building interaction)
    if (nIdx === ctx.goalIdx) {
        return true;
    }
    return !_buildingBitmap[nIdx];
}

function computePriority(from: Tile, neighbor: Tile, gCost: number, direction: number, ctx: SearchContext): number {
    const h = hexDistance(neighbor.x, neighbor.y, ctx.goal.x, ctx.goal.y) * COST_SCALE;
    const targetDir = getDirectionToward(from.x, from.y, ctx.goal.x, ctx.goal.y);
    let dirDiff = Math.abs(direction - targetDir);
    if (dirDiff > 3) {
        dirDiff = 6 - dirDiff;
    }
    return gCost + h + dirDiff * 2;
}

function processNeighbor(current: Tile, currentIdx: number, direction: number, ctx: SearchContext): void {
    const [dx, dy] = GRID_DELTAS[direction]!;
    const neighbor: Tile = { x: current.x + dx, y: current.y + dy };
    const { mapWidth, mapHeight } = ctx.terrain;
    if (!isInMapBounds(neighbor, mapWidth, mapHeight)) {
        return;
    }

    const nIdx = tileIndex(neighbor, mapWidth);
    if (!canEnterTile(nIdx, ctx)) {
        return;
    }

    const tentativeG = ctx.gCost[currentIdx]! + MOVE_COST;
    if (tentativeG >= ctx.gCost[nIdx]!) {
        return;
    }

    ctx.gCost[nIdx] = tentativeG;
    ctx.parent[nIdx] = currentIdx;
    ctx.flags[nIdx]! |= FLAG_OPEN;
    ctx.openQueue.insert(nIdx, computePriority(current, neighbor, tentativeG, direction, ctx));
}

function reconstructPath(goalIdx: number, parent: Int32Array, mapWidth: number): Tile[] {
    const path: Tile[] = [];
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

let _debugPathCallback: ((raw: Tile[], smoothed: Tile[]) => void) | undefined;

/** Inspect raw vs smoothed paths. Pass undefined to clear. */
export function setPathDebugHook(cb: ((raw: Tile[], smoothed: Tile[]) => void) | undefined): void {
    _debugPathCallback = cb;
}

function diagnoseNeighbor(d: number, start: Tile, groundType: Uint8Array, mapWidth: number, mapHeight: number): string {
    const [dx, dy] = GRID_DELTAS[d]!;
    const nx = start.x + dx;
    const ny = start.y + dy;
    const pos = `d${d}(${nx},${ny})`;
    if (!isInMapBounds({ x: nx, y: ny }, mapWidth, mapHeight)) {
        return pos + ':OOB';
    }
    const nIdx = nx + ny * mapWidth;
    if (!isPassable(groundType[nIdx]!)) {
        return pos + ':terrain';
    }
    if (_buildingBitmap[nIdx]) {
        return pos + ':building';
    }
    return pos + ':closed';
}

function makeFailure(
    start: Tile,
    goal: Tile,
    startIdx: number,
    goalIdx: number,
    nodesSearched: number,
    groundType: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    buildingOccupancy: Set<string>
): PathfindingFailureInfo {
    let neighborInfo = '';
    if (nodesSearched <= 1) {
        const reasons: string[] = [];
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            reasons.push(diagnoseNeighbor(d, start, groundType, mapWidth, mapHeight));
        }
        neighborInfo = ' neighbors=[' + reasons.join(', ') + ']';
    }
    return {
        startPassable: isPassable(groundType[startIdx]!),
        goalPassable: isPassable(groundType[goalIdx]!),
        startInBuilding: buildingOccupancy.has(tileKey(start)),
        goalInBuilding: buildingOccupancy.has(tileKey(goal)),
        nodesSearched,
        exhausted: nodesSearched >= MAX_SEARCH_NODES,
        neighborInfo,
    };
}

function logFailure(start: Tile, goal: Tile, failure: PathfindingFailureInfo, entityId: number | undefined): void {
    const entityTag = entityId !== undefined ? ` entity=${entityId}` : '';
    console.warn(
        `[A*] No path (${start.x},${start.y})->(${goal.x},${goal.y}):${entityTag} ` +
            `searched=${failure.nodesSearched}/${MAX_SEARCH_NODES} ${failure.exhausted ? 'EXHAUSTED' : 'EMPTY_QUEUE'} ` +
            `start[passable=${failure.startPassable}, inBuilding=${failure.startInBuilding}] ` +
            `goal[passable=${failure.goalPassable}, inBuilding=${failure.goalInBuilding}]${failure.neighborInfo}`
    );
}

function buildFinalPath(
    goalIdx: number,
    start: Tile,
    parent: Int32Array,
    mapWidth: number,
    groundType: Uint8Array,
    mapHeight: number,
    buildingOccupancy: Set<string>
): Tile[] {
    const rawPath = reconstructPath(goalIdx, parent, mapWidth);
    const smoothed = smoothPath(rawPath, start, { groundType, mapWidth, mapHeight, buildingOccupancy });
    if (_debugPathCallback) {
        _debugPathCallback(rawPath, smoothed);
    }
    return smoothed;
}

/**
 * Find a path from start to goal.
 *
 * Terrain and building/map-object blocking tiles obstruct. The goal tile is
 * always enterable. Units are ignored — bump/wait handles collisions.
 *
 * @returns `{ ok: true, path }` (empty path = already there) or `{ ok: false, failure }`
 */
export function findPathAStar(
    start: Tile,
    goal: Tile,
    terrain: PathfindingTerrain,
    buildingOccupancy: Set<string>,
    entityId?: number
): PathFindResult {
    if (start.x === goal.x && start.y === goal.y) {
        return { ok: true, path: [] };
    }

    const { mapWidth, mapHeight, groundType } = terrain;
    const goalIdx = tileIndex(goal, mapWidth);
    const startIdx = tileIndex(start, mapWidth);

    if (!isPassable(groundType[goalIdx]!)) {
        return {
            ok: false,
            failure: {
                startPassable: isPassable(groundType[startIdx]!),
                goalPassable: false,
                startInBuilding: false,
                goalInBuilding: false,
                nodesSearched: 0,
                exhausted: false,
                neighborInfo: '',
            },
        };
    }

    const totalTiles = mapWidth * mapHeight;
    prepareBuffers(totalTiles);
    populateBuildingBitmap(buildingOccupancy, mapWidth, totalTiles);

    const ctx: SearchContext = {
        terrain,
        goal,
        goalIdx,
        gCost: _gCost,
        parent: _parent,
        flags: _flags,
        openQueue: _openQueue,
    };

    _gCost[startIdx] = 0;
    _flags[startIdx] = FLAG_OPEN;
    _openQueue.insert(startIdx, hexDistance(start.x, start.y, goal.x, goal.y) * COST_SCALE);

    let nodesSearched = 0;
    while (!_openQueue.isEmpty && nodesSearched < MAX_SEARCH_NODES) {
        const currentIdx = _openQueue.popMin();
        if (_flags[currentIdx]! & FLAG_CLOSED) {
            continue;
        }
        _flags[currentIdx] = FLAG_CLOSED;
        nodesSearched++;

        const cx = currentIdx % mapWidth;
        const cy = (currentIdx - cx) / mapWidth;
        if (cx === goal.x && cy === goal.y) {
            return {
                ok: true,
                path: buildFinalPath(currentIdx, start, _parent, mapWidth, groundType, mapHeight, buildingOccupancy),
            };
        }

        const current: Tile = { x: cx, y: cy };
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            processNeighbor(current, currentIdx, d, ctx);
        }
    }

    const failure = makeFailure(
        start,
        goal,
        startIdx,
        goalIdx,
        nodesSearched,
        groundType,
        mapWidth,
        mapHeight,
        buildingOccupancy
    );
    logFailure(start, goal, failure, entityId);
    return { ok: false, failure };
}

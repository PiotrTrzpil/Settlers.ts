/**
 * Map object movement-blocking logic.
 *
 * Typed objects (MapObjectType enum values) use the `blocking` field from
 * objectInfo.xml — the value is the number of tiles blocked (1 = center only,
 * 2 = center + 1 neighbor, etc.). Tiles are expanded outward via BFS from center.
 * Untyped objects (raw byte subTypes) use the `blocking` flag from the raw
 * object registry — these block only their own tile.
 *
 * Manages a per-entity tracking map so blocked tiles can be cleaned up on removal.
 */

import { tileKey, type Tile } from './entity';
import { getMapObjectBlockingValue } from './data/game-data-access';
import type { MapObjectType } from './types/map-object-types';
import { isHarvestableStone } from './types/map-object-types';
import { GRID_DELTA_X, GRID_DELTA_Y, NUMBER_OF_DIRECTIONS } from './systems/hex-directions';
import { lookupRawObject } from '@/resources/map/raw-object-registry';

/**
 * Harvestable stone blocking shape: 3 wide × 2 tall, anchor at bottom-center.
 *
 * Screen layout (anchor = *):
 *   ◇ ◇ ◇   ← top row
 *   ◇ * ◇   ← bottom row
 *
 * Tile offsets from anchor (0,0):
 *   (-1,-1) (0,-1) (+1,-1)   ← top row (one step north)
 *   (-1, 0) (0, 0) (+1, 0)   ← bottom row
 */
const STONE_BLOCK_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0], // center (anchor)
    [-1, 0], // west
    [1, 0], // east
    [0, -1], // north-east
    [-1, -1], // north-west
    [1, -1], // north-east + east (not a hex neighbor, but a valid tile)
];

/** Collect unvisited hex neighbors of a tile into the results and frontier arrays. */
function collectNeighbors(tile: Tile, visited: Set<string>, results: Tile[], frontier: Tile[], limit: number): boolean {
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        const nx = tile.x + GRID_DELTA_X[d]!;
        const ny = tile.y + GRID_DELTA_Y[d]!;
        const key = `${nx},${ny}`;
        if (visited.has(key)) {
            continue;
        }
        visited.add(key);
        const neighbor = { x: nx, y: ny };
        results.push(neighbor);
        frontier.push(neighbor);
        if (results.length >= limit) {
            return true;
        }
    }
    return false;
}

/**
 * Get `count` tiles starting from center, expanding outward via BFS.
 * Returns center for count=1, center + nearest neighbors for higher counts.
 */
function expandTiles(center: Tile, count: number): Tile[] {
    if (count <= 1) {
        return [center];
    }
    const tiles: Tile[] = [center];
    const visited = new Set<string>();
    visited.add(tileKey(center));
    let frontier = [center];

    while (tiles.length < count && frontier.length > 0) {
        const nextFrontier: Tile[] = [];
        for (const tile of frontier) {
            if (collectNeighbors(tile, visited, tiles, nextFrontier, count)) {
                return tiles;
            }
        }
        frontier = nextFrontier;
    }
    return tiles;
}

/** Get custom blocking shape tiles for specific object types, or null for default BFS. */
function getCustomBlockingShape(subType: number, center: Tile): Tile[] | null {
    if (isHarvestableStone(subType)) {
        return STONE_BLOCK_OFFSETS.map(([dx, dy]) => ({ x: center.x + dx, y: center.y + dy }));
    }
    return null;
}

/**
 * Determine the blocking tile count for a map object subType.
 * Returns 0 if the object doesn't block movement.
 */
function getBlockingTileCount(subType: number | string): number {
    if (typeof subType === 'string') {
        return 0;
    }
    // Typed objects: XML blocking value = number of tiles blocked
    const xmlBlocking = getMapObjectBlockingValue(subType as MapObjectType);
    if (xmlBlocking > 0) {
        return xmlBlocking;
    }
    // Untyped raw objects: check registry for blocking flag (single-tile block)
    const entry = lookupRawObject(subType);
    if (entry?.blocking) {
        return 1;
    }
    return 0;
}

/**
 * Tracks map object blocking state and applies it to a shared occupancy set.
 *
 * The occupancy set is typically `GameState.buildingOccupancy` — the same set
 * that drives the pathfinding bitmap. This class owns the add/remove lifecycle
 * for map-object-contributed keys.
 */
export class MapObjectBlockingTracker {
    /** Entity ID → tile keys blocked by that object (for cleanup on removal). */
    private readonly blockingTiles = new Map<number, string[]>();

    constructor(private readonly occupancy: Set<string>) {}

    /**
     * Register movement-blocking tiles for a map object.
     * No-op if the object type doesn't block movement.
     */
    add(entityId: number, subType: number | string, center: Tile): void {
        // Check for custom blocking shape first (e.g. harvestable stones)
        const customShape = typeof subType === 'number' ? getCustomBlockingShape(subType, center) : null;
        if (customShape) {
            this.registerTiles(entityId, customShape);
            return;
        }
        const count = getBlockingTileCount(subType);
        if (count === 0) {
            return;
        }
        this.registerTiles(entityId, expandTiles(center, count));
    }

    private registerTiles(entityId: number, tiles: Tile[]): void {
        const keys: string[] = [];
        for (const tile of tiles) {
            const key = tileKey(tile);
            keys.push(key);
            this.occupancy.add(key);
        }
        this.blockingTiles.set(entityId, keys);
    }

    /** Remove movement-blocking tiles previously registered for a map object. */
    remove(entityId: number): void {
        const keys = this.blockingTiles.get(entityId);
        if (!keys) {
            return;
        }
        for (const key of keys) {
            this.occupancy.delete(key);
        }
        this.blockingTiles.delete(entityId);
    }

    /** Clear all tracked blocking state (e.g. on game restore). */
    clear(): void {
        this.blockingTiles.clear();
    }
}

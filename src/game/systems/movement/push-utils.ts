/**
 * Utility functions for unit pushing behavior.
 *
 * These standalone functions handle the push/yield logic for unit collisions.
 * Used by MovementSystem internally and exported for testing.
 */

import { TileCoord, tileKey } from '../../entity';
import { isPassable } from '../../terrain';
import { getAllNeighbors, GRID_DELTAS, hexDistance, NUMBER_OF_DIRECTIONS } from '../hex-directions';
import { MovementController } from './movement-controller';
import type { SeededRng } from '../../core/rng';

/**
 * Interface for accessing tile occupancy data.
 * Allows push logic to work with different occupancy sources.
 */
export interface TileOccupancyAccessor {
    has(key: string): boolean;
}

/**
 * Interface for terrain data needed by push functions.
 */
export interface TerrainAccessor {
    groundType: Uint8Array;
    mapWidth: number;
    mapHeight: number;
}

/**
 * Check if a tile is a valid push destination.
 */
function isValidPushTile(nx: number, ny: number, occupancy: TileOccupancyAccessor, terrain?: TerrainAccessor): boolean {
    // Bounds check
    if (terrain) {
        if (nx < 0 || nx >= terrain.mapWidth || ny < 0 || ny >= terrain.mapHeight) {
            return false;
        }
        // Passability check
        const nIdx = nx + ny * terrain.mapWidth;
        if (!isPassable(terrain.groundType[nIdx]!)) return false;
    }
    // Occupancy check
    return !occupancy.has(tileKey(nx, ny));
}

/**
 * Options for findBestNeighbor — the shared neighbor-scoring kernel.
 */
export interface FindNeighborOptions {
    x: number;
    y: number;
    goalX?: number;
    goalY?: number;
    /** Tile to skip (e.g. the blocked waypoint in detour search). */
    excludeTile?: TileCoord;
    /** Per-tile validation callback (bounds, passability, occupancy). */
    isValid: (nx: number, ny: number) => boolean;
}

/**
 * Shared scoring loop for finding the best hex neighbor toward a goal.
 * Uses hexDistance for correct hex-grid scoring.
 * Only accepts lateral (score >= 0) or forward (score > 0) moves —
 * backward moves (score < 0) are rejected to prevent 180° reversals.
 */
export function findBestNeighbor(opts: FindNeighborOptions): TileCoord | null {
    const neighbors = getAllNeighbors({ x: opts.x, y: opts.y });

    let best: TileCoord | null = null;
    let bestScore = -1;

    for (const neighbor of neighbors) {
        if (opts.excludeTile && neighbor.x === opts.excludeTile.x && neighbor.y === opts.excludeTile.y) continue;
        if (!opts.isValid(neighbor.x, neighbor.y)) continue;

        let score = 0;
        if (opts.goalX !== undefined && opts.goalY !== undefined) {
            const currDist = hexDistance(opts.x, opts.y, opts.goalX, opts.goalY);
            const newDist = hexDistance(neighbor.x, neighbor.y, opts.goalX, opts.goalY);
            score = currDist - newDist;
        }

        if (score > bestScore) {
            bestScore = score;
            best = neighbor;
        }
    }

    return best;
}

/**
 * Find a free hex neighbor for a pushed unit, preferring directions
 * that help the unit continue toward its goal.
 * Delegates to findBestNeighbor with push-specific tile validation.
 */
export function findSmartFreeDirection(
    x: number,
    y: number,
    occupancy: TileOccupancyAccessor,
    _rng: SeededRng,
    terrain?: TerrainAccessor,
    goalX?: number,
    goalY?: number
): TileCoord | null {
    return findBestNeighbor({
        x,
        y,
        goalX,
        goalY,
        isValid: (nx, ny) => isValidPushTile(nx, ny, occupancy, terrain),
    });
}

/**
 * Find a random free hex neighbor for a pushed unit.
 * Checks all 6 hex neighbors in a randomized order and returns
 * the first that is passable and unoccupied.
 *
 * @param x Current x position
 * @param y Current y position
 * @param occupancy Tile occupancy map
 * @param rng Seeded random number generator for deterministic shuffling
 * @param terrain Optional terrain data for passability check
 */
export function findRandomFreeDirection(
    x: number,
    y: number,
    occupancy: TileOccupancyAccessor,
    rng: SeededRng,
    terrain?: TerrainAccessor
): TileCoord | null {
    // Create shuffled direction indices using seeded RNG
    const dirs: number[] = [];
    for (let i = 0; i < NUMBER_OF_DIRECTIONS; i++) dirs.push(i);

    // Fisher-Yates shuffle with seeded RNG
    rng.shuffle(dirs);

    for (const d of dirs) {
        const [dx, dy] = GRID_DELTAS[d]!;
        const nx = x + dx;
        const ny = y + dy;

        if (!isValidPushTile(nx, ny, occupancy, terrain)) continue;

        return { x: nx, y: ny };
    }

    return null;
}

/**
 * Determine if a push should be allowed based on entity ID priority.
 * Lower entity IDs have priority; higher IDs yield.
 *
 * @param pushingEntityId Entity trying to push
 * @param blockedEntityId Entity being pushed
 * @returns true if the push is allowed (blocked entity should yield)
 */
export function shouldYieldToPush(pushingEntityId: number, blockedEntityId: number): boolean {
    // Lower ID has priority - only push if blocker has higher ID
    return blockedEntityId > pushingEntityId;
}

/**
 * Execute a push operation on a blocked unit.
 * Moves the blocked unit to a random free neighbor and updates its controller.
 *
 * @param blockedController Controller of the unit being pushed
 * @param occupancy Tile occupancy map
 * @param rng Seeded random number generator
 * @param terrain Optional terrain data
 * @param onPositionUpdate Callback to update entity position in game state
 * @returns true if push succeeded
 */
export function executePush(
    blockedController: MovementController,
    occupancy: TileOccupancyAccessor,
    rng: SeededRng,
    terrain: TerrainAccessor | undefined,
    onPositionUpdate: (entityId: number, x: number, y: number) => void
): boolean {
    const goal = blockedController.goal;
    // Prefer goal-aware push (rejects backward directions).
    // Fall back to random only when all forward/lateral tiles are blocked.
    let freeDir = findSmartFreeDirection(
        blockedController.tileX,
        blockedController.tileY,
        occupancy,
        rng,
        terrain,
        goal?.x,
        goal?.y
    );
    if (!freeDir) {
        freeDir = findRandomFreeDirection(blockedController.tileX, blockedController.tileY, occupancy, rng, terrain);
    }
    if (!freeDir) return false;

    blockedController.handlePush(freeDir.x, freeDir.y);
    onPositionUpdate(blockedController.entityId, freeDir.x, freeDir.y);

    return true;
}

/**
 * Complete push operation: check priority, find free direction, execute push.
 * Convenience function combining shouldYieldToPush + executePush.
 *
 * @param pushingEntityId Entity trying to push
 * @param blockedController Controller of the blocked entity
 * @param occupancy Tile occupancy map
 * @param rng Seeded random number generator
 * @param terrain Optional terrain data
 * @param onPositionUpdate Callback to update entity position
 * @returns true if push succeeded
 */
export function pushUnit(
    pushingEntityId: number,
    blockedController: MovementController,
    occupancy: TileOccupancyAccessor,
    rng: SeededRng,
    terrain: TerrainAccessor | undefined,
    onPositionUpdate: (entityId: number, x: number, y: number) => void
): boolean {
    if (!shouldYieldToPush(pushingEntityId, blockedController.entityId)) {
        return false;
    }
    return executePush(blockedController, occupancy, rng, terrain, onPositionUpdate);
}

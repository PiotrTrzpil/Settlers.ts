import { GameState } from '../game-state';
import { EntityType, tileKey, TileCoord } from '../entity';
import { findPath } from './pathfinding';
import {
    GRID_DELTAS,
    NUMBER_OF_DIRECTIONS,
    getAllNeighbors,
} from './hex-directions';
import { isPassable } from './placement';

/** How many steps ahead to look when doing prefix path repair */
const PATH_REPAIR_DISTANCE = 10;

/**
 * Per-tick movement system.
 * Advances units along their paths based on their speed and delta time.
 * Tracks previous position for smooth visual interpolation.
 * Includes path obstacle repair when blocked by other units.
 */
export function updateMovement(
    state: GameState,
    deltaSec: number,
    groundType?: Uint8Array,
    groundHeight?: Uint8Array,
    mapWidth?: number,
    mapHeight?: number,
): void {
    for (const unit of state.unitStates.values()) {
        if (unit.pathIndex >= unit.path.length) continue;

        unit.moveProgress += unit.speed * deltaSec;

        while (unit.moveProgress >= 1 && unit.pathIndex < unit.path.length) {
            unit.moveProgress -= 1;

            const wp = unit.path[unit.pathIndex];

            // Check if next waypoint is blocked by another unit
            const blockingEntityId = state.tileOccupancy.get(tileKey(wp.x, wp.y));
            const entity = state.getEntity(unit.entityId);
            if (blockingEntityId !== undefined && blockingEntityId !== unit.entityId && entity) {
                const blockingEntity = state.getEntity(blockingEntityId);
                if (blockingEntity && blockingEntity.type === EntityType.Unit) {
                    const resolved = tryResolveObstacle(
                        state, unit.entityId, unit, entity, blockingEntityId,
                        groundType, groundHeight, mapWidth, mapHeight,
                    );
                    if (!resolved) {
                        // Wait and retry next tick (strategy d)
                        unit.moveProgress = 0;
                        break;
                    }
                    // After resolution, re-check if waypoint is still valid
                    const stillBlocked = state.tileOccupancy.get(tileKey(wp.x, wp.y));
                    if (stillBlocked !== undefined && stillBlocked !== unit.entityId) {
                        unit.moveProgress = 0;
                        break;
                    }
                }
            }

            // Store previous position for interpolation
            if (entity) {
                unit.prevX = entity.x;
                unit.prevY = entity.y;
            }

            // Update entity position in game state (handles occupancy)
            state.updateEntityPosition(unit.entityId, wp.x, wp.y);

            unit.pathIndex++;
        }

        // If path is complete, reset
        if (unit.pathIndex >= unit.path.length) {
            unit.path = [];
            unit.pathIndex = 0;
            unit.moveProgress = 0;
            // Sync prev to current so no interpolation offset remains
            const entity = state.getEntity(unit.entityId);
            if (entity) {
                unit.prevX = entity.x;
                unit.prevY = entity.y;
            }
        }
    }
}

/**
 * Try 3 escalating strategies to resolve a blocked path step.
 * Returns true if the obstacle was resolved, false to wait.
 *
 * Strategies:
 *   a) Find a 1-tile detour around the obstacle
 *   b) Recalculate a prefix of the path (up to PATH_REPAIR_DISTANCE steps)
 *   c) Push the blocking unit (lower entity ID yields)
 */
function tryResolveObstacle(
    state: GameState,
    unitId: number,
    unit: { path: TileCoord[]; pathIndex: number },
    entity: { x: number; y: number },
    blockingEntityId: number,
    groundType?: Uint8Array,
    groundHeight?: Uint8Array,
    mapWidth?: number,
    mapHeight?: number,
): boolean {
    // Strategy a: Try a 1-tile detour around the obstacle
    if (groundType && groundHeight && mapWidth && mapHeight) {
        const detour = findDetour(
            state, entity.x, entity.y, unit.path, unit.pathIndex,
            groundType, groundHeight, mapWidth, mapHeight,
        );
        if (detour) {
            // Insert detour tile before current waypoint
            unit.path.splice(unit.pathIndex, 0, detour);
            return true;
        }
    }

    // Strategy b: Recalculate a prefix of the path
    if (groundType && groundHeight && mapWidth && mapHeight) {
        const remainingSteps = unit.path.length - unit.pathIndex;
        let repaired = false;

        if (remainingSteps > PATH_REPAIR_DISTANCE) {
            // Recalculate prefix to a point PATH_REPAIR_DISTANCE steps ahead
            const prefixTargetIdx = Math.min(
                unit.pathIndex + PATH_REPAIR_DISTANCE,
                unit.path.length - 1,
            );
            const prefixTarget = unit.path[prefixTargetIdx];
            const newPrefix = findPath(
                entity.x, entity.y,
                prefixTarget.x, prefixTarget.y,
                groundType, groundHeight, mapWidth, mapHeight,
                state.tileOccupancy,
            );
            if (newPrefix && newPrefix.length > 0) {
                // Replace the prefix portion of the path
                const suffix = unit.path.slice(prefixTargetIdx + 1);
                unit.path = [...newPrefix, ...suffix];
                unit.pathIndex = 0;
                repaired = true;
            }
        } else {
            // Few steps left — recalculate entire remaining path
            const goal = unit.path[unit.path.length - 1];
            const newPath = findPath(
                entity.x, entity.y,
                goal.x, goal.y,
                groundType, groundHeight, mapWidth, mapHeight,
                state.tileOccupancy,
            );
            if (newPath && newPath.length > 0) {
                unit.path = newPath;
                unit.pathIndex = 0;
                repaired = true;
            }
        }

        if (repaired) return true;
    }

    // Strategy c: Push the blocking unit (lower ID yields to higher ID)
    return pushUnit(state, unitId, blockingEntityId, groundType, groundHeight, mapWidth, mapHeight);
}

/**
 * Find a 1-tile detour around a blocked tile.
 * Checks hex neighbors of the current position that are also neighbors of the
 * next-next waypoint (or the blocked waypoint itself), are passable, and unoccupied.
 */
function findDetour(
    state: GameState,
    currentX: number,
    currentY: number,
    path: TileCoord[],
    pathIndex: number,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapWidth: number,
    mapHeight: number,
): TileCoord | null {
    const blockedWp = path[pathIndex];

    // The tile we want to rejoin the path at
    const rejoinWp = pathIndex + 1 < path.length ? path[pathIndex + 1] : blockedWp;

    const neighbors = getAllNeighbors({ x: currentX, y: currentY });

    for (const neighbor of neighbors) {
        // Skip the blocked tile itself
        if (neighbor.x === blockedWp.x && neighbor.y === blockedWp.y) continue;

        // Bounds check
        if (neighbor.x < 0 || neighbor.x >= mapWidth || neighbor.y < 0 || neighbor.y >= mapHeight) {
            continue;
        }

        const nIdx = neighbor.x + neighbor.y * mapWidth;

        // Must be passable
        if (!isPassable(groundType[nIdx])) continue;

        // Must not be occupied
        if (state.tileOccupancy.has(tileKey(neighbor.x, neighbor.y))) continue;

        // Check that this detour tile is adjacent to the rejoin point
        // (so we can step: current -> detour -> rejoin)
        const dxRejoin = Math.abs(neighbor.x - rejoinWp.x);
        const dyRejoin = Math.abs(neighbor.y - rejoinWp.y);
        const isAdjacentToRejoin = (dxRejoin + dyRejoin <= 2) && (dxRejoin <= 1) && (dyRejoin <= 1);

        if (isAdjacentToRejoin) {
            return neighbor;
        }
    }

    return null;
}

/**
 * Push a blocking unit out of the way.
 * Only yields if the blocking unit's ID is higher than the pushing unit's ID
 * (prevents infinite push loops).
 * The pushed unit moves to a random free hex neighbor.
 */
export function pushUnit(
    state: GameState,
    pushingEntityId: number,
    blockedEntityId: number,
    groundType?: Uint8Array,
    groundHeight?: Uint8Array,
    mapWidth?: number,
    mapHeight?: number,
): boolean {
    // Lower ID yields to higher ID — only push if blocker has higher ID
    if (blockedEntityId <= pushingEntityId) return false;

    const blockedEntity = state.getEntity(blockedEntityId);
    if (!blockedEntity) return false;

    const freeDir = findRandomFreeDirection(
        state, blockedEntity.x, blockedEntity.y,
        groundType, groundHeight, mapWidth, mapHeight,
    );
    if (!freeDir) return false;

    // Move the blocked entity to the free tile
    state.updateEntityPosition(blockedEntityId, freeDir.x, freeDir.y);

    // Update unit state if it's a unit
    const blockedUnit = state.unitStates.get(blockedEntityId);
    if (blockedUnit) {
        blockedUnit.prevX = blockedEntity.x;
        blockedUnit.prevY = blockedEntity.y;
        // Clear the blocked unit's path since it was forcibly moved
        blockedUnit.path = [];
        blockedUnit.pathIndex = 0;
        blockedUnit.moveProgress = 0;
    }

    return true;
}

/**
 * Find a random free hex neighbor for a pushed unit.
 * Checks all 6 hex neighbors in a randomized order and returns
 * the first that is passable and unoccupied.
 */
export function findRandomFreeDirection(
    state: GameState,
    x: number,
    y: number,
    groundType?: Uint8Array,
    groundHeight?: Uint8Array,
    mapWidth?: number,
    mapHeight?: number,
): TileCoord | null {
    // Create shuffled direction indices
    const dirs: number[] = [];
    for (let i = 0; i < NUMBER_OF_DIRECTIONS; i++) dirs.push(i);
    // Fisher-Yates shuffle
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const d of dirs) {
        const [dx, dy] = GRID_DELTAS[d];
        const nx = x + dx;
        const ny = y + dy;

        // Bounds check
        if (mapWidth !== undefined && mapHeight !== undefined) {
            if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;
        }

        // Passability check
        if (groundType && mapWidth) {
            const nIdx = nx + ny * mapWidth;
            if (!isPassable(groundType[nIdx])) continue;
        }

        // Occupancy check
        if (state.tileOccupancy.has(tileKey(nx, ny))) continue;

        return { x: nx, y: ny };
    }

    return null;
}

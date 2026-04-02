/**
 * Crowd dispersal — prevents idle units from clumping by nudging
 * crowded units to random free neighbors (flocking repulsion).
 */

import { tileKey, type Tile } from '../../entity';
import { getAllNeighbors } from '../hex-directions';
import { isPassable } from '../../terrain';
import type { MovementController } from './movement-controller';
import type { MovementSystem } from './movement-system';

/** Minimum occupied neighbors to trigger dispersal. */
const CROWD_THRESHOLD = 3;

/** Cooldown range in seconds to prevent jitter. */
const MIN_COOLDOWN = 0.5;
const MAX_COOLDOWN = 1.0;

const dispersalCooldowns = new Map<number, number>();

/** Clean up cooldown entry when a controller is removed. */
export function clearDispersalCooldown(entityId: number): void {
    dispersalCooldowns.delete(entityId);
}

/** Check if a neighbor tile is in-bounds and passable (not building-blocked). */
function isValidNeighbor(
    n: Tile,
    terrainGroundType: Uint8Array,
    terrainMapWidth: number,
    terrainMapHeight: number,
    buildingOccupancy: Set<string>
): boolean {
    if (n.x < 0 || n.x >= terrainMapWidth || n.y < 0 || n.y >= terrainMapHeight) {
        return false;
    }
    const nIdx = n.x + n.y * terrainMapWidth;
    if (!isPassable(terrainGroundType[nIdx]!)) {
        return false;
    }
    return !buildingOccupancy.has(tileKey(n.x, n.y));
}

/** Classify valid neighbors into occupied vs free buckets. Returns true if dispersal should trigger. */
function shouldDisperseAt(
    ctrl: MovementController,
    unitOccupancy: Map<string, number>,
    buildingOccupancy: Set<string>,
    terrainGroundType: Uint8Array,
    terrainMapWidth: number,
    terrainMapHeight: number,
    outFree: Tile[]
): boolean {
    const neighbors = getAllNeighbors({ x: ctrl.tileX, y: ctrl.tileY });
    let occupiedCount = 0;

    for (const n of neighbors) {
        if (!isValidNeighbor(n, terrainGroundType, terrainMapWidth, terrainMapHeight, buildingOccupancy)) {
            continue;
        }
        if (unitOccupancy.has(tileKey(n.x, n.y))) {
            occupiedCount++;
        } else {
            outFree.push(n);
        }
    }

    return occupiedCount >= CROWD_THRESHOLD && outFree.length > 0;
}

/**
 * Run one dispersal pass over idle controllers.
 * Call after the main movement update loop.
 */
export function runCrowdDispersal(
    movementSystem: MovementSystem,
    controllers: Iterable<MovementController>,
    unitOccupancy: Map<string, number>,
    buildingOccupancy: Set<string>,
    terrainGroundType: Uint8Array | undefined,
    terrainMapWidth: number,
    terrainMapHeight: number,
    deltaSec: number
): void {
    if (!terrainGroundType) {
        return;
    }

    for (const ctrl of controllers) {
        if (ctrl.state !== 'idle' || ctrl.busy || ctrl.goal) {
            continue;
        }

        // Tick cooldown — no entry means no cooldown active
        const cooldown = dispersalCooldowns.get(ctrl.entityId);
        // eslint-disable-next-line no-restricted-syntax -- cooldown is nullable by design; 0 means "just expired"
        const remaining = (cooldown ?? 0) - deltaSec;
        if (remaining > 0) {
            dispersalCooldowns.set(ctrl.entityId, remaining);
            continue;
        }

        if (buildingOccupancy.has(tileKey(ctrl.tileX, ctrl.tileY))) {
            continue;
        }

        const freeNeighbors: Tile[] = [];
        if (
            !shouldDisperseAt(
                ctrl,
                unitOccupancy,
                buildingOccupancy,
                terrainGroundType,
                terrainMapWidth,
                terrainMapHeight,
                freeNeighbors
            )
        ) {
            continue;
        }

        // Pick a random free neighbor and move there
        // eslint-disable-next-line sonarjs/pseudo-random -- game dispersal, not security-sensitive
        const dest = freeNeighbors[Math.floor(Math.random() * freeNeighbors.length)]!;
        movementSystem.moveUnit(ctrl.entityId, dest.x, dest.y);

        // Set randomized cooldown
        // eslint-disable-next-line sonarjs/pseudo-random -- game dispersal, not security-sensitive
        dispersalCooldowns.set(ctrl.entityId, MIN_COOLDOWN + Math.random() * (MAX_COOLDOWN - MIN_COOLDOWN));
    }
}

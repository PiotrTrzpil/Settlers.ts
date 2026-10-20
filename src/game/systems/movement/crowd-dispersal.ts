/**
 * Crowd dispersal — idle units in a clump step to a free neighbor.
 */

import { tileKey, isInMapBounds, type Tile } from '../../core/coordinates';
import { getAllNeighbors } from '../hex-directions';
import { isPassable } from '../../terrain';
import type { SeededRng } from '../../core/rng';
import type { PathfindingTerrain } from '../pathfinding';
import type { MovementController } from './movement-controller';
import type { MovementSystem } from './movement-system';

const CROWD_THRESHOLD = 3;
const MIN_COOLDOWN = 0.5;
const MAX_COOLDOWN = 1.0;

const dispersalCooldowns = new Map<number, number>();

export function clearDispersalCooldown(entityId: number): void {
    dispersalCooldowns.delete(entityId);
}

function isValidNeighbor(n: Tile, terrain: PathfindingTerrain, buildingOccupancy: Set<string>): boolean {
    if (!isInMapBounds(n, terrain.mapWidth, terrain.mapHeight)) {
        return false;
    }
    const nIdx = n.x + n.y * terrain.mapWidth;
    if (!isPassable(terrain.groundType[nIdx]!)) {
        return false;
    }
    return !buildingOccupancy.has(tileKey(n));
}

function shouldDisperseAt(
    ctrl: MovementController,
    unitOccupancy: Map<string, number>,
    buildingOccupancy: Set<string>,
    terrain: PathfindingTerrain,
    outFree: Tile[]
): boolean {
    const neighbors = getAllNeighbors({ x: ctrl.tileX, y: ctrl.tileY });
    let occupiedCount = 0;

    for (const n of neighbors) {
        if (!isValidNeighbor(n, terrain, buildingOccupancy)) {
            continue;
        }
        if (unitOccupancy.has(tileKey(n))) {
            occupiedCount++;
        } else {
            outFree.push(n);
        }
    }

    return occupiedCount >= CROWD_THRESHOLD && outFree.length > 0;
}

/**
 * One dispersal pass over idle controllers. Call after the main movement update.
 */
export function runCrowdDispersal(
    movementSystem: MovementSystem,
    controllers: Iterable<MovementController>,
    unitOccupancy: Map<string, number>,
    buildingOccupancy: Set<string>,
    terrain: PathfindingTerrain | undefined,
    rng: SeededRng,
    deltaSec: number
): void {
    if (!terrain) {
        return;
    }

    for (const ctrl of controllers) {
        if (ctrl.state !== 'idle' || ctrl.busy || ctrl.goal) {
            continue;
        }

        const cooldown = dispersalCooldowns.get(ctrl.entityId);
        // eslint-disable-next-line no-restricted-syntax -- cooldown is nullable by design; 0 means "just expired"
        const remaining = (cooldown ?? 0) - deltaSec;
        if (remaining > 0) {
            dispersalCooldowns.set(ctrl.entityId, remaining);
            continue;
        }

        if (buildingOccupancy.has(tileKey({ x: ctrl.tileX, y: ctrl.tileY }))) {
            continue;
        }

        const freeNeighbors: Tile[] = [];
        if (!shouldDisperseAt(ctrl, unitOccupancy, buildingOccupancy, terrain, freeNeighbors)) {
            continue;
        }

        const dest = rng.pick(freeNeighbors)!;
        movementSystem.moveUnit(ctrl.entityId, dest);
        dispersalCooldowns.set(ctrl.entityId, MIN_COOLDOWN + rng.next() * (MAX_COOLDOWN - MIN_COOLDOWN));
    }
}

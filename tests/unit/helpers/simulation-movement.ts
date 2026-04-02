/**
 * Movement simulation helper — step-by-step movement tracking for pathfinding tests.
 */

import type { Tile } from '@/game/entity';
import type { Simulation } from './test-simulation';

export interface SimulateMovementOptions {
    maxTicks?: number;
    target?: Tile;
}

/**
 * Run tick-by-tick movement simulation, recording each tile the unit visits.
 * Stops when the unit reaches the target (if given) or finishes its path.
 */
export function simulateMovement(sim: Simulation, entityId: number, opts: SimulateMovementOptions = {}): Tile[] {
    const { maxTicks = 600, target } = opts;
    const entity = sim.state.getEntityOrThrow(entityId, 'simulateMovement');
    const unitState = sim.state.unitStates.get(entityId)!;
    const visited: Tile[] = [{ x: entity.x, y: entity.y }];
    const dt = 1 / 30;

    for (let i = 0; i < maxTicks; i++) {
        sim.tick(dt);
        const last = visited[visited.length - 1]!;
        if (entity.x !== last.x || entity.y !== last.y) {
            visited.push({ x: entity.x, y: entity.y });
        }
        if (target) {
            if (entity.x === target.x && entity.y === target.y) break;
        } else {
            if (unitState.path.length === 0 && unitState.moveProgress === 0 && visited.length > 1) {
                break;
            }
        }
    }
    return visited;
}

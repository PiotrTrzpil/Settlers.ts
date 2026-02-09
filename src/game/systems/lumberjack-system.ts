import type { GameState } from '../game-state';
import { EntityType, UnitType, MapObjectType, Entity } from '../entity';
import { OBJECT_TYPE_CATEGORY } from './map-objects';
import { LogHandler } from '@/utilities/log-handler';
import { MovementController } from './movement/movement-controller';
import { getAllNeighbors } from './hex-directions';
import type { TickSystem } from '../tick-system';

const log = new LogHandler('LumberjackSystem');

enum LumberjackState {
    IDLE = 0,
    MOVING = 1,
    CHOPPING = 2,
    RETURNING = 3, // Future: Return to hut
}

interface LumberjackData {
    state: LumberjackState;
    targetEntityId: number | null;
    chopTimer: number;
}

const CHOP_DURATION = 2.0; // Seconds to chop a tree
const SEARCH_RADIUS = 30; // Tiles

export class LumberjackSystem implements TickSystem {
    private lumberjackData = new Map<number, LumberjackData>();
    private gameState: GameState;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /** TickSystem interface */
    tick(dt: number): void {
        this.update(this.gameState, dt);
    }

    public update(state: GameState, deltaSec: number): void {
        const lumberjacks = state.entities.filter(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter);

        for (const unit of lumberjacks) {
            let data = this.lumberjackData.get(unit.id);
            if (!data) {
                data = { state: LumberjackState.IDLE, targetEntityId: null, chopTimer: 0 };
                this.lumberjackData.set(unit.id, data);
            }

            this.updateUnit(state, unit, data, deltaSec);
        }

        // Cleanup removed units
        for (const id of this.lumberjackData.keys()) {
            if (!state.getEntity(id)) {
                this.lumberjackData.delete(id);
            }
        }
    }

    private updateUnit(state: GameState, unit: Entity, data: LumberjackData, deltaSec: number): void {
        const controller = state.movement.getController(unit.id);
        if (!controller) return;

        switch (data.state) {
        case LumberjackState.IDLE:
            this.handleIdle(state, unit, data);
            break;
        case LumberjackState.MOVING:
            this.handleMoving(state, unit, data, controller);
            break;
        case LumberjackState.CHOPPING:
            this.handleChopping(state, unit, data, deltaSec);
            break;
        }
    }

    private handleIdle(state: GameState, unit: Entity, data: LumberjackData): void {
        const tree = this.findNearestTree(state, unit.x, unit.y);
        if (tree) {
            // log.debug(`Unit ${unit.id} found tree ${tree.id} at ${tree.x},${tree.y}`);
            data.targetEntityId = tree.id;

            // Try to move to the tree directly (MovementSystem might handle "move to adjacent")
            // But usually we need to move to a neighbor.
            // Let's try neighbors first.
            const neighbors = getAllNeighbors({ x: tree.x, y: tree.y });
            let moved = false;

            // Sort neighbors by distance to unit to pick the closest one
            neighbors.sort((a, b) => {
                const dA = (a.x - unit.x) ** 2 + (a.y - unit.y) ** 2;
                const dB = (b.x - unit.x) ** 2 + (b.y - unit.y) ** 2;
                return dA - dB;
            });

            for (const n of neighbors) {
                if (state.movement.moveUnit(unit.id, n.x, n.y)) {
                    data.state = LumberjackState.MOVING;
                    moved = true;
                    break;
                }
            }

            if (!moved) {
                // If no neighbor is reachable, maybe try the tree itself (might fail if solid)
                if (state.movement.moveUnit(unit.id, tree.x, tree.y)) {
                    data.state = LumberjackState.MOVING;
                } else {
                    // Start chopping if already adjacent
                    const dist = Math.abs(unit.x - tree.x) + Math.abs(unit.y - tree.y);
                    if (dist <= 1) {
                        data.state = LumberjackState.CHOPPING;
                        data.chopTimer = CHOP_DURATION;
                    }
                }
            }
        }
    }

    private handleMoving(state: GameState, unit: Entity, data: LumberjackData, controller: MovementController): void {
        if (!data.targetEntityId) {
            data.state = LumberjackState.IDLE;
            return;
        }

        const target = state.getEntity(data.targetEntityId);
        if (!target) {
            controller.clearPath();
            data.state = LumberjackState.IDLE;
            data.targetEntityId = null;
            return;
        }

        if (controller.state === 'idle') {
            const dist = Math.abs(unit.x - target.x) + Math.abs(unit.y - target.y);
            // Allow distance 1 (adjacent) or 0 (on top)
            if (dist <= 1) {
                data.state = LumberjackState.CHOPPING;
                data.chopTimer = CHOP_DURATION;
            } else {
                data.state = LumberjackState.IDLE;
            }
        }
    }

    private handleChopping(state: GameState, unit: Entity, data: LumberjackData, deltaSec: number): void {
        data.chopTimer -= deltaSec;
        if (data.chopTimer <= 0) {
            if (data.targetEntityId) {
                const target = state.getEntity(data.targetEntityId);
                if (target) {
                    log.debug(`Unit ${unit.id} chopped tree ${target.id}`);
                    state.removeEntity(target.id);
                }
            }
            data.state = LumberjackState.IDLE;
            data.targetEntityId = null;
        }
    }

    private findNearestTree(state: GameState, x: number, y: number): Entity | null {
        let nearest: Entity | null = null;
        let minDistSq = Infinity;

        for (const entity of state.entities) {
            if (entity.type === EntityType.MapObject) {
                const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
                if (category === 'trees') {
                    const dx = entity.x - x;
                    const dy = entity.y - y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < SEARCH_RADIUS * SEARCH_RADIUS && distSq < minDistSq) {
                        minDistSq = distSq;
                        nearest = entity;
                    }
                }
            }
        }
        return nearest;
    }
}

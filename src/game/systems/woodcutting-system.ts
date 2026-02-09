import type { GameState } from '../game-state';
import { EntityType, UnitType, MapObjectType, Entity } from '../entity';
import { OBJECT_TYPE_CATEGORY } from './map-objects';
import { LogHandler } from '@/utilities/log-handler';
import { MovementController } from './movement/movement-controller';
import { getAllNeighbors, getApproxDirection } from './hex-directions';
import type { TickSystem } from '../tick-system';
import { ANIMATION_SEQUENCES, createAnimationState, setAnimationSequence } from '../animation';

const log = new LogHandler('WoodcuttingSystem');

enum WoodcuttingState {
    IDLE = 0,
    MOVING = 1,
    CHOPPING = 2,
    RETURNING = 3, // Future: Return to hut
}

interface WoodcuttingData {
    state: WoodcuttingState;
    targetEntityId: number | null;
    chopTimer: number;
}

const CHOP_DURATION = 2.0; // Seconds to chop a tree
const SEARCH_RADIUS = 30; // Tiles

export class WoodcuttingSystem implements TickSystem {
    private woodcutterData = new Map<number, WoodcuttingData>();
    private gameState: GameState;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /** TickSystem interface */
    tick(dt: number): void {
        this.update(this.gameState, dt);
    }

    public update(state: GameState, deltaSec: number): void {
        const woodcutters = state.entities.filter(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter);

        for (const unit of woodcutters) {
            let data = this.woodcutterData.get(unit.id);
            if (!data) {
                data = { state: WoodcuttingState.IDLE, targetEntityId: null, chopTimer: 0 };
                this.woodcutterData.set(unit.id, data);
            }

            this.updateUnit(state, unit, data, deltaSec);
        }

        // Cleanup removed units
        for (const id of this.woodcutterData.keys()) {
            if (!state.getEntity(id)) {
                this.woodcutterData.delete(id);
            }
        }
    }

    private updateUnit(state: GameState, unit: Entity, data: WoodcuttingData, deltaSec: number): void {
        const controller = state.movement.getController(unit.id);
        if (!controller) return;

        switch (data.state) {
        case WoodcuttingState.IDLE:
            this.handleIdle(state, unit, data);
            break;
        case WoodcuttingState.MOVING:
            this.handleMoving(state, unit, data, controller);
            break;
        case WoodcuttingState.CHOPPING:
            this.handleChopping(state, unit, data, deltaSec);
            break;
        }
    }

    private handleIdle(state: GameState, unit: Entity, data: WoodcuttingData): void {
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
                    data.state = WoodcuttingState.MOVING;
                    moved = true;
                    break;
                }
            }

            if (!moved) {
                // If no neighbor is reachable, maybe try the tree itself (might fail if solid)
                if (state.movement.moveUnit(unit.id, tree.x, tree.y)) {
                    data.state = WoodcuttingState.MOVING;
                } else {
                    // Start chopping if already adjacent
                    const dist = Math.abs(unit.x - tree.x) + Math.abs(unit.y - tree.y);
                    if (dist <= 1) {
                        this.startChopping(unit, tree, data);
                    }
                }
            }
        }
    }

    private startChopping(unit: Entity, target: Entity, data: WoodcuttingData): void {
        data.state = WoodcuttingState.CHOPPING;
        data.chopTimer = CHOP_DURATION;

        // Set work animation facing the tree
        const direction = getApproxDirection(unit.x, unit.y, target.x, target.y);

        if (!unit.animationState) {
            unit.animationState = createAnimationState(ANIMATION_SEQUENCES.WORK, direction);
        }
        setAnimationSequence(unit.animationState, ANIMATION_SEQUENCES.WORK, direction);
    }

    private stopChopping(unit: Entity, data: WoodcuttingData): void {
        data.state = WoodcuttingState.IDLE;
        data.targetEntityId = null;

        // Return to default animation
        if (unit.animationState) {
            setAnimationSequence(unit.animationState, ANIMATION_SEQUENCES.DEFAULT);
        }
    }

    private handleMoving(state: GameState, unit: Entity, data: WoodcuttingData, controller: MovementController): void {
        if (!data.targetEntityId) {
            data.state = WoodcuttingState.IDLE;
            return;
        }

        const target = state.getEntity(data.targetEntityId);
        if (!target) {
            controller.clearPath();
            data.state = WoodcuttingState.IDLE;
            data.targetEntityId = null;
            return;
        }

        if (controller.state === 'idle') {
            const dist = Math.abs(unit.x - target.x) + Math.abs(unit.y - target.y);
            // Allow distance 1 (adjacent) or 0 (on top)
            if (dist <= 1) {
                this.startChopping(unit, target, data);
            } else {
                data.state = WoodcuttingState.IDLE;
            }
        }
    }

    private handleChopping(state: GameState, unit: Entity, data: WoodcuttingData, deltaSec: number): void {
        data.chopTimer -= deltaSec;
        if (data.chopTimer <= 0) {
            if (data.targetEntityId) {
                const target = state.getEntity(data.targetEntityId);
                if (target) {
                    log.debug(`Unit ${unit.id} chopped tree ${target.id}`);
                    state.removeEntity(target.id);
                }
            }
            this.stopChopping(unit, data);
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

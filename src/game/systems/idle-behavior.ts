/**
 * Idle behavior and animation direction system.
 *
 * This system is responsible for updating unit animation states based on
 * movement state. It is fully decoupled from the movement system:
 * - Movement system handles logical tile movement
 * - This system handles visual animation direction and idle behavior
 *
 * Responsibilities:
 * - Direction changes during movement (based on dx/dy from controller)
 * - Random idle turns after standing still for a while
 * - Smooth direction transitions
 * - Tracking idle time per unit (independent of movement state)
 */

import type { GameState } from '../game-state';
import { EntityType } from '../entity';
import { MovementController } from './movement/movement-controller';
import {
    AnimationState,
    createAnimationState,
    startDirectionTransition,
    updateDirectionTransition
} from '../animation';
import type { TickSystem } from '../tick-system';

/**
 * Per-unit idle animation state.
 * Tracked separately from movement to maintain decoupling.
 */
interface IdleAnimationState {
    idleTime: number;
    nextIdleTurnTime: number;
}

/**
 * IdleBehaviorSystem — manages animation direction and idle turning for all units.
 * Implements TickSystem for registration with GameLoop.
 */
export class IdleBehaviorSystem implements TickSystem {
    private idleStates = new Map<number, IdleAnimationState>();
    private gameState: GameState;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /** TickSystem interface */
    tick(dt: number): void {
        const deltaMs = dt * 1000;

        for (const controller of this.gameState.movement.getAllControllers()) {
            const entity = this.gameState.getEntity(controller.entityId);
            if (!entity || entity.type !== EntityType.Unit) continue;

            const idleState = this.getIdleState(controller.entityId);
            entity.animationState = updateUnitAnimation(
                controller,
                idleState,
                entity.animationState,
                deltaMs,
                dt
            );
        }
    }

    /** Clean up idle state for removed entities. */
    cleanupIdleState(entityId: number): void {
        this.idleStates.delete(entityId);
    }

    /** Get or create idle state for an entity. */
    private getIdleState(entityId: number): IdleAnimationState {
        let state = this.idleStates.get(entityId);
        if (!state) {
            state = {
                idleTime: 0,
                nextIdleTurnTime: 2 + Math.random() * 4,
            };
            this.idleStates.set(entityId, state);
        }
        return state;
    }
}

/**
 * Update animation state for a single unit based on its movement controller.
 *
 * @param controller The unit's movement controller (provides movement state)
 * @param idleState The unit's idle animation state (owned by this system)
 * @param animState The current animation state (or undefined to create new)
 * @param deltaMs Time since last update in milliseconds
 * @param deltaSec Time since last update in seconds
 * @returns Updated animation state
 */
function updateUnitAnimation(
    controller: MovementController,
    idleState: IdleAnimationState,
    animState: AnimationState | undefined,
    deltaMs: number,
    deltaSec: number
): AnimationState {
    // Create animation state if not present
    if (!animState) {
        animState = createAnimationState('idle', 0);
    }

    // Update any in-progress direction transitions
    updateDirectionTransition(animState, deltaMs);

    // If moving, update direction based on movement
    if (controller.state === 'moving' && controller.isInTransit) {
        const newDir = controller.computeMovementDirection();
        if (newDir !== -1 && newDir !== animState.direction) {
            startDirectionTransition(animState, newDir);
        }
        // Reset idle state when moving
        idleState.idleTime = 0;
    }
    // If idle, handle random direction changes
    else if (controller.state === 'idle' && !controller.isInTransit) {
        idleState.idleTime += deltaSec;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            const newDirection = getAdjacentDirection(animState.direction);
            startDirectionTransition(animState, newDirection);
            idleState.idleTime = 0;
            idleState.nextIdleTurnTime = 2 + Math.random() * 4;
        }
    }

    return animState;
}

/** Number of sprite directions (matches hex grid) */
const NUM_DIRECTIONS = 6;

/**
 * Get an adjacent direction for idle turning.
 * Randomly chooses clockwise (+1) or counter-clockwise (-1) rotation.
 * Wraps around since all 6 directions are visually adjacent on the hex grid.
 */
function getAdjacentDirection(currentDirection: number): number {
    const offset = Math.random() < 0.5 ? 1 : -1;
    return ((currentDirection + offset) % NUM_DIRECTIONS + NUM_DIRECTIONS) % NUM_DIRECTIONS;
}

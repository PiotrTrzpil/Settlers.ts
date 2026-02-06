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

import { GameState } from '../game-state';
import { EntityType } from '../entity';
import { MovementController } from './movement/movement-controller';
import {
    AnimationState,
    createAnimationState,
    startDirectionTransition,
    updateDirectionTransition
} from '../animation';

/**
 * Per-unit idle animation state.
 * Tracked separately from movement to maintain decoupling.
 */
interface IdleAnimationState {
    idleTime: number;
    nextIdleTurnTime: number;
}

/** Map of entity ID to idle animation state */
const idleStates = new Map<number, IdleAnimationState>();

/**
 * Get or create idle state for an entity.
 */
function getIdleState(entityId: number): IdleAnimationState {
    let state = idleStates.get(entityId);
    if (!state) {
        state = {
            idleTime: 0,
            nextIdleTurnTime: 2 + Math.random() * 4,
        };
        idleStates.set(entityId, state);
    }
    return state;
}

/**
 * Clean up idle state for removed entities.
 * Call this when entities are removed from the game.
 */
export function cleanupIdleState(entityId: number): void {
    idleStates.delete(entityId);
}

/**
 * Updates animation direction for all units based on their movement state.
 *
 * @param state The game state containing entities and movement controllers
 * @param deltaSec Time elapsed since last update in seconds
 */
export function updateIdleBehavior(state: GameState, deltaSec: number): void {
    const deltaMs = deltaSec * 1000;

    for (const controller of state.movement.getAllControllers()) {
        const entity = state.getEntity(controller.entityId);
        if (!entity || entity.type !== EntityType.Unit) continue;

        const idleState = getIdleState(controller.entityId);
        entity.animationState = updateUnitAnimation(
            controller,
            idleState,
            entity.animationState,
            deltaMs,
            deltaSec
        );
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

/**
 * Get an adjacent direction for idle turning.
 * Avoids jarring left↔right transitions by not wrapping around.
 */
function getAdjacentDirection(currentDirection: number): number {
    if (currentDirection === 0) {
        // RIGHT can only turn to RIGHT_BOTTOM
        return 1;
    } else if (currentDirection === 3) {
        // LEFT can only turn to LEFT_BOTTOM
        return 2;
    } else {
        // Directions 1 and 2 can go either way
        const offset = Math.random() < 0.5 ? 1 : -1;
        return currentDirection + offset;
    }
}

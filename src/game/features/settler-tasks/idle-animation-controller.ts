/**
 * Idle animation controller for settler units.
 *
 * Manages idle turning, walk animation, task animation application,
 * and the transition between idle and working animation states.
 * Stateless service — caller provides the per-unit idle state.
 */

import type { Entity } from '../../entity';
import { ANIMATION_SEQUENCES } from '../../animation';
import { resolveTaskAnimation, type AnimationService } from '../../animation/index';
import type { TaskNode } from './types';

/** Number of sprite directions (matches hex grid) */
const NUM_DIRECTIONS = 6;

/** Idle animation state for random turning */
export interface IdleAnimationState {
    idleTime: number;
    nextIdleTurnTime: number;
}

/** Minimal RNG interface needed by the controller */
export interface RngSource {
    next(): number;
    nextBool(): boolean;
}

export class IdleAnimationController {
    constructor(
        private readonly animationService: AnimationService,
        private readonly rng: RngSource
    ) {}

    /** Create initial idle animation state with a randomised first turn time. */
    createIdleState(): IdleAnimationState {
        return {
            idleTime: 0,
            nextIdleTurnTime: 2 + this.rng.next() * 4,
        };
    }

    /**
     * Update idle behaviour for a unit that is not executing a job.
     * Handles the case where the unit might be moving (pushed) or standing.
     * @param movementState - current movement controller state ('idle' | 'moving' | undefined)
     * @param movementDirection - current facing direction from the movement controller
     */
    updateIdleUnit(
        unit: Entity,
        idleState: IdleAnimationState,
        dt: number,
        movementState: string | undefined,
        movementDirection: number = 0
    ): void {
        // If unit is moving (e.g., pushed), play walk animation
        if (movementState === 'moving') {
            const animState = this.animationService.getState(unit.id);
            if (!animState?.playing || animState.sequenceKey !== ANIMATION_SEQUENCES.WALK) {
                this.startWalkAnimation(unit, movementDirection);
            }
            idleState.idleTime = 0;
            return;
        }

        // Ensure idle animation state exists (units that never moved won't have one),
        // and reset walk animations — but don't override fight animations (managed by combat system)
        const animState = this.animationService.getState(unit.id);
        if (!animState || (animState.playing && !animState.sequenceKey.startsWith(ANIMATION_SEQUENCES.FIGHT_PREFIX))) {
            this.setIdleAnimation(unit);
        }

        this.updateIdleTurning(unit, idleState, dt);
    }

    /**
     * Handle random idle turning for standing units.
     */
    updateIdleTurning(unit: Entity, idleState: IdleAnimationState, dt: number): void {
        idleState.idleTime += dt;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            // Animation state may be missing during cleanup
            const animState = this.animationService.getState(unit.id);
            if (!animState) return;
            const newDirection = this.getAdjacentDirection(animState.direction);
            this.animationService.setDirection(unit.id, newDirection);

            idleState.idleTime = 0;
            idleState.nextIdleTurnTime = 2 + this.rng.next() * 4;
        }
    }

    /**
     * Apply animation for the current task. Resolves semantic animation type
     * to a concrete sequence key via AnimationResolver, then applies it.
     */
    applyTaskAnimation(settler: Entity, task: TaskNode): void {
        const intent = resolveTaskAnimation(task.anim, settler);
        this.animationService.applyIntent(settler.id, intent);
    }

    /**
     * Start walk animation for a unit (used for move tasks and external movement).
     */
    startWalkAnimation(unit: Entity, direction: number): void {
        const intent = resolveTaskAnimation('walk', unit);
        this.animationService.applyIntent(unit.id, intent);
        this.animationService.setDirection(unit.id, direction);
    }

    /**
     * Set idle animation (stopped, default pose).
     */
    setIdleAnimation(settler: Entity): void {
        const intent = resolveTaskAnimation('idle', settler);
        this.animationService.applyIntent(settler.id, intent);
    }

    /** Get an adjacent direction for idle turning. */
    private getAdjacentDirection(currentDirection: number): number {
        const offset = this.rng.nextBool() ? 1 : -1;
        return (((currentDirection + offset) % NUM_DIRECTIONS) + NUM_DIRECTIONS) % NUM_DIRECTIONS;
    }
}

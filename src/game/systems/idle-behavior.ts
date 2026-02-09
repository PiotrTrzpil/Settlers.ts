/**
 * Idle behavior and animation system.
 *
 * Event-driven architecture:
 * - Subscribes to movement events (started, stopped, direction changed)
 * - Reacts to state changes instead of polling
 * - Tick only handles time-based logic (direction transitions, idle turns)
 *
 * Responsibilities:
 * - Start/stop walk animation based on movement events
 * - Smooth direction transitions when direction changes
 * - Random idle turns after standing still for a while
 */

import type { GameState } from '../game-state';
import { Entity, EntityType, UnitType } from '../entity';
import type { EventBus } from '../event-bus';
import {
    AnimationState,
    ANIMATION_SEQUENCES,
    carrySequenceKey,
    createAnimationState,
    setAnimationSequence,
    startDirectionTransition,
    updateDirectionTransition
} from '../animation';
import type { TickSystem } from '../tick-system';

/**
 * Per-unit idle animation state.
 */
interface IdleAnimationState {
    idleTime: number;
    nextIdleTurnTime: number;
}

/** Number of sprite directions (matches hex grid) */
const NUM_DIRECTIONS = 6;

/**
 * IdleBehaviorSystem — manages unit animations via movement events.
 *
 * Architecture:
 * - Movement events trigger animation state changes (no polling)
 * - Tick only updates time-based logic (transitions, idle turns)
 */
export class IdleBehaviorSystem implements TickSystem {
    private idleStates = new Map<number, IdleAnimationState>();
    private gameState: GameState;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /**
     * Subscribe to movement events from the event bus.
     * Call this after construction to wire up event handling.
     */
    registerEvents(eventBus: EventBus): void {
        eventBus.on('unit:movementStarted', ({ entityId, direction }) => {
            this.onMovementStarted(entityId, direction);
        });

        eventBus.on('unit:movementStopped', ({ entityId }) => {
            this.onMovementStopped(entityId);
        });

        eventBus.on('unit:directionChanged', ({ entityId, direction, previousDirection }) => {
            this.onDirectionChanged(entityId, direction, previousDirection);
        });
    }

    /**
     * Handle unit starting to move.
     * Starts walk animation and sets direction.
     */
    private onMovementStarted(entityId: number, direction: number): void {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return;

        const animState = this.ensureAnimationState(entity);

        // Start walk animation
        const targetSeq = getWalkSequenceKey(entity);
        setAnimationSequence(animState, targetSeq, direction);

        // Reset idle state
        const idleState = this.getIdleState(entityId);
        idleState.idleTime = 0;
    }

    /**
     * Handle unit stopping movement.
     * Switches to default/standing pose.
     */
    private onMovementStopped(entityId: number): void {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return;

        const animState = this.ensureAnimationState(entity);

        // Switch to default/standing sequence and stop animation
        animState.sequenceKey = ANIMATION_SEQUENCES.DEFAULT;
        animState.playing = false;
        animState.currentFrame = 0;
    }

    /**
     * Handle direction change during movement.
     * Starts smooth transition to new direction.
     */
    private onDirectionChanged(entityId: number, direction: number, _previousDirection: number): void {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return;

        const animState = this.ensureAnimationState(entity);

        // Start smooth direction transition
        if (direction !== animState.direction) {
            startDirectionTransition(animState, direction);
        }
    }

    /**
     * TickSystem interface — handles time-based updates only.
     * Animation state changes happen via events, not here.
     */
    tick(dt: number): void {
        const deltaMs = dt * 1000;

        for (const controller of this.gameState.movement.getAllControllers()) {
            const entity = this.gameState.getEntity(controller.entityId);
            if (!entity || entity.type !== EntityType.Unit) continue;

            const animState = entity.animationState;
            if (!animState) continue;

            // Update direction transitions (smooth blending)
            updateDirectionTransition(animState, deltaMs);

            // Handle idle turning (only when idle)
            if (controller.state === 'idle') {
                this.updateIdleTurn(controller.entityId, animState, dt);
            }
        }
    }

    /**
     * Update idle turn timer and trigger random turns.
     */
    private updateIdleTurn(entityId: number, animState: AnimationState, deltaSec: number): void {
        const idleState = this.getIdleState(entityId);
        idleState.idleTime += deltaSec;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            const newDirection = getAdjacentDirection(animState.direction);
            startDirectionTransition(animState, newDirection);
            idleState.idleTime = 0;
            idleState.nextIdleTurnTime = 2 + Math.random() * 4;
        }
    }

    /** Ensure entity has animation state, creating if needed. */
    private ensureAnimationState(entity: Entity): AnimationState {
        if (!entity.animationState) {
            entity.animationState = createAnimationState(ANIMATION_SEQUENCES.DEFAULT, 0);
        }
        return entity.animationState;
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
 * Determine the correct walk sequence key for a unit.
 * Carriers carrying a material use a material-specific carry sequence;
 * all other units (and empty carriers) use the generic walk sequence.
 */
function getWalkSequenceKey(entity: Entity): string {
    if (entity.subType === UnitType.Carrier && entity.carriedMaterial !== undefined) {
        return carrySequenceKey(entity.carriedMaterial);
    }
    return ANIMATION_SEQUENCES.WALK;
}

/**
 * Get an adjacent direction for idle turning.
 * Randomly chooses clockwise (+1) or counter-clockwise (-1) rotation.
 */
function getAdjacentDirection(currentDirection: number): number {
    const offset = Math.random() < 0.5 ? 1 : -1;
    return ((currentDirection + offset) % NUM_DIRECTIONS + NUM_DIRECTIONS) % NUM_DIRECTIONS;
}

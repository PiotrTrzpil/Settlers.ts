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
import { ANIMATION_SEQUENCES, carrySequenceKey } from '../animation';
import type { AnimationService } from '../animation/index';
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
 * - Tick only updates time-based logic (idle turns)
 * - Defers to other systems (e.g., SettlerTaskSystem) for managed units
 */
export class IdleBehaviorSystem implements TickSystem {
    private idleStates = new Map<number, IdleAnimationState>();
    private gameState: GameState;
    private animationService: AnimationService;

    /**
     * Optional callback to check if a unit's animation is managed by another system.
     * If set and returns true, this system won't touch that unit's animation.
     */
    private isAnimationManaged?: (entityId: number) => boolean;

    constructor(gameState: GameState, animationService: AnimationService) {
        this.gameState = gameState;
        this.animationService = animationService;
    }

    /**
     * Set callback to check if a unit is managed by another animation system.
     * Managed units will be skipped for animation updates.
     */
    setManagedCheck(check: (entityId: number) => boolean): void {
        this.isAnimationManaged = check;
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
        // Skip if managed by another system (e.g., SettlerTaskSystem)
        if (this.isAnimationManaged?.(entityId)) return;

        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return;

        // Start walk animation
        const sequenceKey = getWalkSequenceKey(entity);
        this.animationService.play(entityId, sequenceKey, { loop: true, direction });

        // Reset idle state
        const idleState = this.getIdleState(entityId);
        idleState.idleTime = 0;
    }

    /**
     * Handle unit stopping movement.
     * Switches to default/standing pose.
     */
    private onMovementStopped(entityId: number): void {
        // Skip if managed by another system (e.g., SettlerTaskSystem)
        if (this.isAnimationManaged?.(entityId)) return;

        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return;

        // Set default sequence and hold on frame 0 (play sets sequence, stop freezes it)
        this.animationService.play(entityId, ANIMATION_SEQUENCES.DEFAULT);
        this.animationService.stop(entityId);
    }

    /**
     * Handle direction change during movement.
     * Sets new direction on animation.
     */
    private onDirectionChanged(entityId: number, direction: number, _previousDirection: number): void {
        // Direction changes are fine even for managed units
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return;

        this.animationService.setDirection(entityId, direction);
    }

    /**
     * TickSystem interface — handles time-based updates only.
     * Animation state changes happen via events, not here.
     */
    tick(dt: number): void {
        for (const controller of this.gameState.movement.getAllControllers()) {
            // Handle idle turning (only when idle and not managed by another system)
            if (controller.state === 'idle' && !this.isAnimationManaged?.(controller.entityId)) {
                this.updateIdleTurn(controller.entityId, dt);
            }
        }
    }

    /**
     * Update idle turn timer and trigger random turns.
     */
    private updateIdleTurn(entityId: number, deltaSec: number): void {
        const idleState = this.getIdleState(entityId);
        idleState.idleTime += deltaSec;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            const animState = this.animationService.getState(entityId);
            const currentDirection = animState?.direction ?? 0;
            const newDirection = this.getAdjacentDirection(currentDirection);
            this.animationService.setDirection(entityId, newDirection);
            idleState.idleTime = 0;
            idleState.nextIdleTurnTime = 2 + this.gameState.rng.next() * 4;
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
                nextIdleTurnTime: 2 + this.gameState.rng.next() * 4,
            };
            this.idleStates.set(entityId, state);
        }
        return state;
    }

    /**
     * Get an adjacent direction for idle turning.
     * Randomly chooses clockwise (+1) or counter-clockwise (-1) rotation.
     */
    private getAdjacentDirection(currentDirection: number): number {
        const offset = this.gameState.rng.nextBool() ? 1 : -1;
        return ((currentDirection + offset) % NUM_DIRECTIONS + NUM_DIRECTIONS) % NUM_DIRECTIONS;
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


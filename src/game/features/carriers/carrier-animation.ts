/**
 * CarrierAnimationController - Handles carrier animation states.
 *
 * Responsibilities:
 * - Switch between normal and carrying animations
 * - Trigger pickup and drop animations
 * - Track animation delays for state transitions
 */

import type { GameState } from '../../game-state';
import type { EMaterialType } from '../../economy';
import {
    ANIMATION_SEQUENCES,
    carrySequenceKey,
    setAnimationSequence,
} from '../../animation';

/** Duration of pickup/drop animations in milliseconds */
export const PICKUP_ANIMATION_DURATION_MS = 500;
export const DROP_ANIMATION_DURATION_MS = 400;

/**
 * Animation state for a carrier undergoing a timed animation.
 */
export interface AnimationTimer {
    carrierId: number;
    animationType: 'pickup' | 'drop';
    startTimeMs: number;
    durationMs: number;
}

/**
 * Controller that manages carrier animation states.
 *
 * This controller interfaces with the animation system to change
 * animation sequences when carriers pick up or drop materials.
 */
export class CarrierAnimationController {
    /** Active animation timers for pickup/drop */
    private activeTimers: Map<number, AnimationTimer> = new Map();

    /**
     * Set the carrying animation for a carrier.
     *
     * Switches the carrier's animation to the carrying variant
     * for the specified material type.
     *
     * @param entityId Entity ID of the carrier
     * @param materialType Material being carried
     * @param gameState Game state to access entity
     */
    setCarryingAnimation(
        entityId: number,
        materialType: EMaterialType,
        gameState: GameState,
    ): void {
        const entity = gameState.getEntity(entityId);
        if (!entity || !entity.animationState) return;

        // Use the carry sequence for this material
        const sequenceKey = carrySequenceKey(materialType);
        setAnimationSequence(entity.animationState, sequenceKey);
    }

    /**
     * Clear the carrying animation and return to normal walk.
     *
     * @param entityId Entity ID of the carrier
     * @param gameState Game state to access entity
     */
    clearCarryingAnimation(entityId: number, gameState: GameState): void {
        const entity = gameState.getEntity(entityId);
        if (!entity || !entity.animationState) return;

        // Return to default walk animation
        setAnimationSequence(entity.animationState, ANIMATION_SEQUENCES.WALK);
    }

    /**
     * Start the pickup animation for a carrier.
     *
     * This begins a timed animation state. Use isAnimationComplete()
     * to check when it finishes.
     *
     * @param entityId Entity ID of the carrier
     * @param gameState Game state to access entity
     * @param currentTimeMs Current time in milliseconds
     */
    playPickupAnimation(
        entityId: number,
        gameState: GameState,
        currentTimeMs: number,
    ): void {
        const entity = gameState.getEntity(entityId);
        if (!entity || !entity.animationState) return;

        // Start a timer for the pickup animation
        this.activeTimers.set(entityId, {
            carrierId: entityId,
            animationType: 'pickup',
            startTimeMs: currentTimeMs,
            durationMs: PICKUP_ANIMATION_DURATION_MS,
        });

        // For now, we just use the default animation while "picking up"
        // A more complete implementation would switch to a pickup-specific sequence
        // if one exists in the sprite data
        setAnimationSequence(entity.animationState, ANIMATION_SEQUENCES.DEFAULT);
    }

    /**
     * Start the drop animation for a carrier.
     *
     * This begins a timed animation state. Use isAnimationComplete()
     * to check when it finishes.
     *
     * @param entityId Entity ID of the carrier
     * @param gameState Game state to access entity
     * @param currentTimeMs Current time in milliseconds
     */
    playDropAnimation(
        entityId: number,
        gameState: GameState,
        currentTimeMs: number,
    ): void {
        const entity = gameState.getEntity(entityId);
        if (!entity || !entity.animationState) return;

        // Start a timer for the drop animation
        this.activeTimers.set(entityId, {
            carrierId: entityId,
            animationType: 'drop',
            startTimeMs: currentTimeMs,
            durationMs: DROP_ANIMATION_DURATION_MS,
        });

        // Use default animation during drop
        setAnimationSequence(entity.animationState, ANIMATION_SEQUENCES.DEFAULT);
    }

    /**
     * Check if a timed animation has completed.
     *
     * @param entityId Entity ID of the carrier
     * @param currentTimeMs Current time in milliseconds
     * @returns true if animation is complete or no animation was active
     */
    isAnimationComplete(entityId: number, currentTimeMs: number): boolean {
        const timer = this.activeTimers.get(entityId);
        if (!timer) return true;

        const elapsed = currentTimeMs - timer.startTimeMs;
        return elapsed >= timer.durationMs;
    }

    /**
     * Get remaining time for an active animation.
     *
     * @param entityId Entity ID of the carrier
     * @param currentTimeMs Current time in milliseconds
     * @returns Remaining time in ms, or 0 if no animation or complete
     */
    getRemainingAnimationTime(entityId: number, currentTimeMs: number): number {
        const timer = this.activeTimers.get(entityId);
        if (!timer) return 0;

        const elapsed = currentTimeMs - timer.startTimeMs;
        const remaining = timer.durationMs - elapsed;
        return Math.max(0, remaining);
    }

    /**
     * Get the active animation type for a carrier.
     *
     * @param entityId Entity ID of the carrier
     * @returns 'pickup', 'drop', or undefined if no animation active
     */
    getActiveAnimationType(entityId: number): 'pickup' | 'drop' | undefined {
        const timer = this.activeTimers.get(entityId);
        return timer?.animationType;
    }

    /**
     * Clear the animation timer for a carrier.
     * Call this after handling animation completion.
     *
     * @param entityId Entity ID of the carrier
     */
    clearAnimationTimer(entityId: number): void {
        this.activeTimers.delete(entityId);
    }

    /**
     * Check if a carrier has an active animation timer.
     */
    hasActiveAnimation(entityId: number): boolean {
        return this.activeTimers.has(entityId);
    }

    /**
     * Get all carriers with active animation timers.
     * Useful for batch processing.
     */
    getCarriersWithActiveAnimations(): number[] {
        return [...this.activeTimers.keys()];
    }

    /**
     * Clear all animation timers.
     */
    clear(): void {
        this.activeTimers.clear();
    }
}

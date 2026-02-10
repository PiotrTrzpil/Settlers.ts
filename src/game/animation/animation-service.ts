/**
 * Animation Service
 *
 * Central owner of all animation state and timing. This is the ONLY way to
 * control entity animations. Domain systems call play/stop/setDirection.
 *
 * ## Architecture
 *
 * - AnimationService owns all animation state (frame, elapsed time, playing)
 * - Domain systems only call play/stop/setDirection with sequence keys
 * - Renderer reads state via getState() for sprite lookup
 * - No direct manipulation of entity fields for animation
 *
 * ## Sequence Keys
 *
 * Sequence keys are strings that identify animation types:
 * - 'default' - Standing still (idle pose)
 * - 'walk' - Walking animation (looped)
 * - 'work.0', 'work.1', etc. - Work animations by subType
 * - 'carry_5' - Carrying material type 5 (EMaterialType)
 *
 * The renderer maps sequence keys to actual sprites using unit type and JIL data.
 *
 * ## Usage Patterns
 *
 * Starting movement:
 *   animationService.play(entityId, 'walk', { loop: true, direction: dir });
 *
 * Stopping movement (hold on frame 0):
 *   animationService.play(entityId, 'default');
 *   animationService.stop(entityId);
 *
 * Work animation (non-looping):
 *   animationService.play(entityId, 'work.0', { loop: false });
 *
 * Carrying animation:
 *   animationService.play(entityId, `carry_${materialType}`, { loop: true });
 *
 * Changing direction mid-animation:
 *   animationService.setDirection(entityId, newDirection);
 *
 * ## Important Notes
 *
 * - play() with same sequence key just updates options, doesn't restart
 * - stop() holds on current frame (use for idle poses after play('default'))
 * - Direction persists when changing sequences
 * - Call remove() when entity is destroyed
 */

import { ANIMATION_DEFAULTS } from '../animation';

/**
 * Animation state for a single entity.
 * Compatible with legacy AnimationState for renderer integration.
 */
export interface AnimationState {
    sequenceKey: string;
    currentFrame: number;
    direction: number;
    elapsedMs: number;
    playing: boolean;
    // Internal use - not exposed to sprite lookup
    loop: boolean;
    // Direction transition support (for smooth blending)
    previousDirection?: number;
    directionTransitionProgress?: number;
}

/**
 * Options when playing an animation.
 */
export interface PlayOptions {
    loop?: boolean;
    direction?: number;
    startFrame?: number;
}

/**
 * Animation Service - owns all animation state and timing.
 */
export class AnimationService {
    private states = new Map<number, AnimationState>();

    /**
     * Play an animation on an entity.
     */
    play(entityId: number, sequenceKey: string, options: PlayOptions = {}): void {
        const existing = this.states.get(entityId);

        // If same sequence, just update options
        if (existing && existing.sequenceKey === sequenceKey) {
            if (options.direction !== undefined) {
                existing.direction = options.direction;
            }
            if (options.loop !== undefined) {
                existing.loop = options.loop;
            }
            existing.playing = true;
            return;
        }

        // New sequence - create fresh state
        this.states.set(entityId, {
            sequenceKey,
            currentFrame: options.startFrame ?? 0,
            direction: options.direction ?? existing?.direction ?? 0,
            elapsedMs: 0,
            loop: options.loop ?? false,
            playing: true,
        });
    }

    /**
     * Stop animation (hold on current frame).
     */
    stop(entityId: number): void {
        const state = this.states.get(entityId);
        if (state) {
            state.playing = false;
        }
    }

    /**
     * Set direction without changing animation.
     */
    setDirection(entityId: number, direction: number): void {
        const state = this.states.get(entityId);
        if (state) {
            state.direction = direction;
        }
    }

    /**
     * Get current animation state for an entity.
     * Used by renderer for sprite lookup.
     */
    getState(entityId: number): AnimationState | null {
        return this.states.get(entityId) ?? null;
    }

    /**
     * Check if entity has animation state.
     */
    hasState(entityId: number): boolean {
        return this.states.has(entityId);
    }

    /**
     * Update all animations. Call once per frame.
     */
    update(deltaMs: number): void {
        const frameDuration = ANIMATION_DEFAULTS.FRAME_DURATION_MS;

        for (const state of this.states.values()) {
            if (!state.playing) continue;

            state.elapsedMs += deltaMs;

            while (state.elapsedMs >= frameDuration) {
                state.elapsedMs -= frameDuration;
                state.currentFrame++;
            }
        }
    }

    /**
     * Remove animation state for an entity.
     */
    remove(entityId: number): void {
        this.states.delete(entityId);
    }

    /**
     * Clean up state for entities that no longer exist.
     */
    cleanup(existingIds: Set<number>): void {
        for (const entityId of this.states.keys()) {
            if (!existingIds.has(entityId)) {
                this.states.delete(entityId);
            }
        }
    }
}

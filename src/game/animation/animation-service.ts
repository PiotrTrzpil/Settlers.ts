/**
 * Animation Service
 *
 * Central owner of all animation state and timing. This is the ONLY way to
 * control entity animations. Systems call play/stop/setDirection or applyIntent.
 *
 * ## Usage
 *
 * Preferred (declarative):
 *   animationService.applyIntent(entityId, resolveTaskAnimation('walk', entity));
 *
 * Low-level (imperative — for trees, buildings, non-task entities):
 *   animationService.play(entityId, 'walk', { loop: true, direction: dir });
 *   animationService.setDirection(entityId, newDirection);
 *   animationService.stop(entityId);
 *
 * ## Important
 *
 * - play() with same sequence key just updates options, doesn't restart
 * - stop() holds on current frame (use for idle poses after play('default'))
 * - Direction persists when changing sequences
 * - Call remove() when entity is destroyed
 */

import { ANIMATION_DEFAULTS, type AnimationState } from '../animation';
import type { AnimationIntent } from './animation-resolver';

/** Internal state extends AnimationState with loop tracking. */
interface InternalAnimationState extends AnimationState {
    loop: boolean;
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
    private states = new Map<number, InternalAnimationState>();

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
     * Apply an animation intent (from AnimationResolver).
     * Efficiently updates state — no-op if sequence is unchanged.
     */
    applyIntent(entityId: number, intent: AnimationIntent): void {
        if (intent.stopped) {
            this.play(entityId, intent.sequence, { loop: false });
            this.stop(entityId);
        } else {
            this.play(entityId, intent.sequence, { loop: intent.loop });
        }
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

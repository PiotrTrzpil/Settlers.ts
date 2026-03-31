/**
 * EntityVisualService
 *
 * Central owner of visual state (static sprite + animation) for all entities.
 * Replaces the split between AnimationService (animation-only) and scattered
 * variation/sprite tracking across systems.
 *
 * ## Design
 *
 * Every entity has an EntityVisualState containing:
 *   - variation: the fallback static sprite index (always set)
 *   - animation: active AnimationPlayback, or null for static-only entities
 *
 * Direction transitions are stored separately (sparse map) — only units use them.
 *
 * ## Usage
 *
 * Preferred (declarative):
 *   visualService.applyIntent(entityId, { sequence: 'WC_WALK', loop: true, stopped: false });
 *
 * Atomic combined operations (most common for state changes):
 *   visualService.setAnimated(entityId, variation, 'walk', { loop: true, direction: dir });
 *   visualService.setStatic(entityId, variation);
 *
 * Low-level:
 *   visualService.setVariation(entityId, variation);
 *   visualService.play(entityId, 'walk', { loop: true, direction: dir });
 *   visualService.clearAnimation(entityId);
 *   visualService.setDirection(entityId, newDirection);
 *
 * ## Important
 *
 * - init() must be called before any other method for a given entity
 * - remove() is safe to call on non-existent entities (cleanup path)
 * - play() with same sequence key just updates options, doesn't restart
 * - setDirection() requires an active animation — throws otherwise
 * - Call remove() when entity is destroyed
 */

import { ANIMATION_DEFAULTS } from './animation';
/** What animation should play on an entity */
export interface AnimationIntent {
    /** Sequence key (XML name, e.g., 'WC_WALK', 'SML01_FIGHT') */
    sequence: string;
    /** Whether the animation should loop */
    loop: boolean;
    /** If true, freeze on frame 0 (idle pose) */
    stopped: boolean;
    /** If true, entity becomes invisible after the animation finishes (non-looping only) */
    hideOnComplete?: boolean;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Static sprite index + optional active animation for one entity. */
export interface EntityVisualState {
    /** Static sprite index. Always set. Renderer uses this when animation is null or can't resolve. */
    variation: number;
    /** Active animation, or null for static-only entities. */
    animation: AnimationPlayback | null;
}

/** Tracks playback position within a named animation sequence. */
export interface AnimationPlayback {
    sequenceKey: string;
    direction: number;
    currentFrame: number;
    elapsedMs: number;
    loop: boolean;
    playing: boolean;
    /** When true, the entity becomes invisible after a non-looping animation finishes. */
    hideOnComplete: boolean;
}

/** Unit-only: smooth direction change. Stored separately because most entities never use it. */
export interface DirectionTransition {
    previousDirection: number;
    /** 0.0 = old direction, 1.0 = new direction */
    progress: number;
}

/** Options when playing an animation. */
export interface PlayOptions {
    loop?: boolean;
    direction?: number;
    startFrame?: number;
    /** When true, the entity becomes invisible after a non-looping animation finishes. */
    hideOnComplete?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh AnimationPlayback, preserving direction from an existing one if present. */
function createPlayback(sequenceKey: string, opts: PlayOptions, existing: AnimationPlayback | null): AnimationPlayback {
    return {
        sequenceKey,
        currentFrame: opts.startFrame ?? 0,
        direction: opts.direction ?? existing?.direction ?? 0,
        elapsedMs: 0,
        loop: opts.loop ?? false,
        playing: true,
        hideOnComplete: opts.hideOnComplete ?? false,
    };
}

// ---------------------------------------------------------------------------
// EntityVisualService
// ---------------------------------------------------------------------------

/**
 * EntityVisualService — owns all visual state (sprite + animation) for entities.
 */
export class EntityVisualService {
    private states = new Map<number, EntityVisualState>();
    private transitions = new Map<number, DirectionTransition>(); // sparse, units only

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Create visual state for an entity. Must be called before any other method.
     * Throws if state already exists (programming error: double-init).
     */
    init(entityId: number, variation = 0): void {
        if (this.states.has(entityId)) {
            throw new Error(
                `EntityVisualService.init: entity ${entityId} already has visual state. ` +
                    `Call remove() before re-initialising.`
            );
        }
        this.states.set(entityId, { variation, animation: null });
    }

    /**
     * Delete state and transitions for an entity.
     * Safe to call on non-existent entities (cleanup path — no throw).
     */
    remove(entityId: number): void {
        this.states.delete(entityId);
        this.transitions.delete(entityId);
    }

    // -------------------------------------------------------------------------
    // State access
    // -------------------------------------------------------------------------

    /**
     * Get visual state or throw with context if missing.
     * Use for required-state access (systems that must not operate on missing entities).
     */
    getStateOrThrow(entityId: number, caller: string): EntityVisualState {
        const state = this.states.get(entityId);
        if (!state) {
            throw new Error(
                `EntityVisualService.${caller}: no visual state for entity ${entityId}. ` +
                    `Ensure init() was called when the entity was created.`
            );
        }
        return state;
    }

    /**
     * Get visual state or null. Used at renderer boundaries where entities may
     * be missing (race conditions, cleanup ordering).
     */
    getState(entityId: number): EntityVisualState | null {
        return this.states.get(entityId) ?? null;
    }

    // -------------------------------------------------------------------------
    // Static sprite
    // -------------------------------------------------------------------------

    /**
     * Change the static sprite index. Does NOT touch the animation.
     */
    setVariation(entityId: number, variation: number): void {
        const state = this.getStateOrThrow(entityId, 'setVariation');
        state.variation = variation;
    }

    // -------------------------------------------------------------------------
    // Animation
    // -------------------------------------------------------------------------

    /**
     * Start or update animation on an entity.
     *
     * - Same sequence key: update direction/loop/playing without restarting.
     * - New sequence key: create fresh AnimationPlayback.
     * - Direction defaults to existing animation direction (if any), then 0.
     */
    play(entityId: number, sequenceKey: string, opts: PlayOptions = {}): void {
        const state = this.getStateOrThrow(entityId, 'play');
        const existing = state.animation;

        if (existing && existing.sequenceKey === sequenceKey) {
            // Same sequence — update options without restarting
            if (opts.direction !== undefined) {
                existing.direction = opts.direction;
            }
            if (opts.loop !== undefined) {
                existing.loop = opts.loop;
            }
            existing.playing = true;
            return;
        }

        // New sequence — create fresh playback, preserve direction from old state
        state.animation = createPlayback(sequenceKey, opts, existing);
    }

    /**
     * Clear the active animation (set to null). Entity becomes static-only.
     */
    clearAnimation(entityId: number): void {
        const state = this.getStateOrThrow(entityId, 'clearAnimation');
        state.animation = null;
    }

    /**
     * Update animation direction. Throws if there is no active animation.
     */
    setDirection(entityId: number, direction: number): void {
        const state = this.getStateOrThrow(entityId, 'setDirection');
        if (!state.animation) {
            throw new Error(
                `EntityVisualService.setDirection: entity ${entityId} has no active animation. ` +
                    `Call play() before setDirection().`
            );
        }
        state.animation.direction = direction;
    }

    // -------------------------------------------------------------------------
    // Atomic combined operations
    // -------------------------------------------------------------------------

    /**
     * Set variation AND clear animation atomically (entity becomes static-only).
     */
    setStatic(entityId: number, variation: number): void {
        const state = this.getStateOrThrow(entityId, 'setStatic');
        state.variation = variation;
        state.animation = null;
    }

    /**
     * Set variation AND start animation atomically.
     */
    setAnimated(entityId: number, variation: number, sequenceKey: string, opts?: PlayOptions): void {
        const state = this.getStateOrThrow(entityId, 'setAnimated');
        state.variation = variation;

        const existing = state.animation;
        if (existing && existing.sequenceKey === sequenceKey) {
            // Same sequence — update options without restarting
            if (opts?.direction !== undefined) {
                existing.direction = opts.direction;
            }
            if (opts?.loop !== undefined) {
                existing.loop = opts.loop;
            }
            existing.playing = true;
        } else {
            state.animation = createPlayback(sequenceKey, opts ?? {}, existing);
        }
    }

    // -------------------------------------------------------------------------
    // Intent API
    // -------------------------------------------------------------------------

    /**
     * Apply a resolved animation intent. If intent.stopped, play then freeze on frame 0.
     * Otherwise play with intent.loop.
     */
    applyIntent(entityId: number, intent: AnimationIntent): void {
        if (intent.stopped) {
            this.play(entityId, intent.sequence, { loop: false });
            const state = this.getStateOrThrow(entityId, 'applyIntent');
            if (state.animation) {
                state.animation.playing = false;
                state.animation.currentFrame = 0;
                state.animation.elapsedMs = 0;
            }
        } else {
            this.play(entityId, intent.sequence, { loop: intent.loop, hideOnComplete: intent.hideOnComplete });
        }
    }

    // -------------------------------------------------------------------------
    // Direction transitions (units only)
    // -------------------------------------------------------------------------

    /**
     * Begin a smooth direction transition for a unit.
     */
    startDirectionTransition(entityId: number, from: number, to: number): void {
        const state = this.getStateOrThrow(entityId, 'startDirectionTransition');
        this.transitions.set(entityId, { previousDirection: from, progress: 0 });
        if (state.animation) {
            state.animation.direction = to;
        }
    }

    /**
     * Advance the direction transition progress for a unit (0.0 → 1.0).
     */
    updateDirectionTransition(entityId: number, progress: number): void {
        const transition = this.transitions.get(entityId);
        if (!transition) {
            throw new Error(
                `EntityVisualService.updateDirectionTransition: entity ${entityId} has no active ` +
                    `direction transition. Call startDirectionTransition() first.`
            );
        }
        transition.progress = progress;
    }

    /**
     * Remove direction transition for a unit (transition complete).
     */
    clearDirectionTransition(entityId: number): void {
        this.transitions.delete(entityId);
    }

    /**
     * Get current direction transition, or null if none active.
     */
    getDirectionTransition(entityId: number): DirectionTransition | null {
        return this.transitions.get(entityId) ?? null;
    }

    // -------------------------------------------------------------------------
    // Frame tick
    // -------------------------------------------------------------------------

    /**
     * Advance all playing animations by deltaMs. Call once per frame.
     */
    update(deltaMs: number): void {
        const frameDuration = ANIMATION_DEFAULTS.FRAME_DURATION_MS;

        for (const state of this.states.values()) {
            const anim = state.animation;
            if (!anim || !anim.playing) {
                continue;
            }

            anim.elapsedMs += deltaMs;

            while (anim.elapsedMs >= frameDuration) {
                anim.elapsedMs -= frameDuration;
                anim.currentFrame++;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    /**
     * Remove visual states for entities not present in the given set.
     * Call periodically to avoid memory leaks from orphaned entities.
     */
    cleanup(existingIds: Set<number>): void {
        for (const entityId of this.states.keys()) {
            if (!existingIds.has(entityId)) {
                this.states.delete(entityId);
                this.transitions.delete(entityId);
            }
        }
    }
}

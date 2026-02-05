/**
 * Animation system types and interfaces.
 * Supports frame-based sprite animations for entities.
 */

import { SpriteEntry } from './renderer/sprite-metadata';

/**
 * Default animation timing constants (in milliseconds).
 */
export const ANIMATION_DEFAULTS = {
    /** Default duration per frame for most animations */
    FRAME_DURATION_MS: 120,
    /** Faster animations (e.g., running) */
    FAST_FRAME_DURATION_MS: 80,
    /** Slower animations (e.g., idle, ambient) */
    SLOW_FRAME_DURATION_MS: 200,
} as const;

/**
 * Animation sequence definition.
 * Contains all frames for a single animation and playback settings.
 */
export interface AnimationSequence {
    /** Sprite entries for each frame (atlas regions with offsets) */
    frames: SpriteEntry[];
    /** Duration per frame in milliseconds */
    frameDurationMs: number;
    /** Whether the animation loops */
    loop: boolean;
}

/**
 * Runtime animation state for an entity.
 * Tracks current playback position within an animation.
 */
export interface AnimationState {
    /** Current animation sequence key (e.g., "idle", "walk", "work") */
    sequenceKey: string;
    /** Current frame index within the sequence */
    currentFrame: number;
    /** Time elapsed in current frame (milliseconds) */
    elapsedMs: number;
    /** Direction index for directional animations (0-7, or 0-1 for buildings) */
    direction: number;
    /** Whether animation is currently playing */
    playing: boolean;
}

/**
 * Complete animation data for an entity type.
 * Maps sequence names to their definitions per direction.
 */
export interface AnimationData {
    /** Map of sequence key -> direction -> animation sequence */
    sequences: Map<string, Map<number, AnimationSequence>>;
    /** Default sequence key to use */
    defaultSequence: string;
}

/**
 * Creates a default animation state.
 */
export function createAnimationState(
    sequenceKey: string = 'default',
    direction: number = 0
): AnimationState {
    return {
        sequenceKey,
        currentFrame: 0,
        elapsedMs: 0,
        direction,
        playing: true,
    };
}

/**
 * Updates an animation state based on elapsed time.
 * Returns true if the frame changed.
 */
export function updateAnimationState(
    state: AnimationState,
    sequence: AnimationSequence | undefined,
    deltaMs: number
): boolean {
    if (!state.playing || !sequence || sequence.frames.length === 0) {
        return false;
    }

    const previousFrame = state.currentFrame;
    state.elapsedMs += deltaMs;

    // Advance frames based on elapsed time
    while (state.elapsedMs >= sequence.frameDurationMs) {
        state.elapsedMs -= sequence.frameDurationMs;
        state.currentFrame++;

        if (state.currentFrame >= sequence.frames.length) {
            if (sequence.loop) {
                state.currentFrame = 0;
            } else {
                state.currentFrame = sequence.frames.length - 1;
                state.playing = false;
                break;
            }
        }
    }

    return state.currentFrame !== previousFrame;
}

/**
 * Gets the current sprite entry for an animation state.
 */
export function getCurrentAnimationSprite(
    state: AnimationState,
    animationData: AnimationData | undefined
): SpriteEntry | null {
    if (!animationData) return null;

    const directionMap = animationData.sequences.get(state.sequenceKey);
    if (!directionMap) return null;

    const sequence = directionMap.get(state.direction);
    if (!sequence || sequence.frames.length === 0) return null;

    const frameIndex = Math.min(state.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex];
}

/**
 * Sets the animation to a new sequence.
 * Resets frame and elapsed time.
 */
export function setAnimationSequence(
    state: AnimationState,
    sequenceKey: string,
    direction?: number
): void {
    state.sequenceKey = sequenceKey;
    state.currentFrame = 0;
    state.elapsedMs = 0;
    state.playing = true;
    if (direction !== undefined) {
        state.direction = direction;
    }
}

/**
 * Sets just the direction, keeping the current sequence.
 */
export function setAnimationDirection(
    state: AnimationState,
    direction: number
): void {
    if (state.direction !== direction) {
        state.direction = direction;
        // Optionally reset frame when direction changes
        // state.currentFrame = 0;
        // state.elapsedMs = 0;
    }
}

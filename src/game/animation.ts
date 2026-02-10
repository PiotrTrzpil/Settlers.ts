/**
 * Animation system types and interfaces.
 * Supports frame-based sprite animations for entities.
 */

import { SpriteEntry } from './renderer/sprite-metadata';

/**
 * Well-known animation sequence keys.
 * Shared between idle-behavior (producer) and sprite-metadata (registrar)
 * so the contract isn't just magic strings.
 */
export const ANIMATION_SEQUENCES = {
    /** Default/idle animation */
    DEFAULT: 'default',
    /** Walking/movement animation */
    WALK: 'walk',
    /** Prefix for carry-walk animations, suffixed with material type number */
    CARRY_PREFIX: 'carry_',
    /** Working animation (e.g., chopping, mining) */
    WORK: 'work',
} as const;

/**
 * Get the animation sequence key for a carrier carrying a specific material.
 * Returns a key like 'carry_0' (trunk), 'carry_9' (plank), etc.
 */
export function carrySequenceKey(materialType: number): string {
    return `${ANIMATION_SEQUENCES.CARRY_PREFIX}${materialType}`;
}

/**
 * Check if a sequence key is a carry sequence.
 */
export function isCarrySequence(sequenceKey: string): boolean {
    return sequenceKey.startsWith(ANIMATION_SEQUENCES.CARRY_PREFIX);
}

/**
 * Default animation timing constants (in milliseconds).
 * All animations use the same speed for visual consistency.
 */
export const ANIMATION_DEFAULTS = {
    /** Duration per frame for all animations (matches JIL viewer) */
    FRAME_DURATION_MS: 100,
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

/** Duration of direction transition blend in milliseconds */
export const DIRECTION_TRANSITION_DURATION_MS = 125;

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
    /** Direction index for directional animations (0-3 for units, 0-1 for buildings) */
    direction: number;
    /** Whether animation is currently playing */
    playing: boolean;
    /** Previous direction during a transition (for blending) */
    previousDirection?: number;
    /** Progress of direction transition (0 = old direction, 1 = new direction) */
    directionTransitionProgress?: number;
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
 * Defaults to not playing (static pose) - movement events will start animation.
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
        playing: false,
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
 * Use startDirectionTransition() for smooth blended transitions.
 */
export function setAnimationDirection(
    state: AnimationState,
    direction: number
): void {
    if (state.direction !== direction) {
        state.direction = direction;
        // Clear any in-progress transition
        state.previousDirection = undefined;
        state.directionTransitionProgress = undefined;
    }
}

/**
 * Starts a smooth transition to a new direction.
 * The renderer will blend between old and new direction sprites.
 */
export function startDirectionTransition(
    state: AnimationState,
    newDirection: number
): void {
    if (state.direction === newDirection) return;

    // If already transitioning, use current blended state as the "previous"
    // (This handles rapid direction changes smoothly)
    state.previousDirection = state.direction;
    state.direction = newDirection;
    state.directionTransitionProgress = 0;
}

/**
 * Updates direction transition progress.
 * Call this every frame during transitions.
 * @returns true if transition is still in progress
 */
export function updateDirectionTransition(
    state: AnimationState,
    deltaMs: number
): boolean {
    if (state.directionTransitionProgress === undefined) {
        return false;
    }

    state.directionTransitionProgress += deltaMs / DIRECTION_TRANSITION_DURATION_MS;

    if (state.directionTransitionProgress >= 1) {
        // Transition complete
        state.previousDirection = undefined;
        state.directionTransitionProgress = undefined;
        return false;
    }

    return true;
}

/**
 * Check if direction transition is in progress.
 */
export function isDirectionTransitioning(state: AnimationState): boolean {
    return state.directionTransitionProgress !== undefined &&
           state.directionTransitionProgress < 1;
}

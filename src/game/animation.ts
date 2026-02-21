/**
 * Animation types, constants, and sprite lookup.
 *
 * This file defines the shared contract between:
 * - AnimationService (owns runtime state)
 * - AnimationResolver (derives intent from entity state)
 * - SpriteRenderManager (registers animation data)
 * - EntityRenderer (looks up sprites per frame)
 */

import { SpriteEntry } from './renderer/sprite-metadata';

/**
 * Well-known animation sequence keys.
 * Shared between producers (AnimationResolver) and registrars (SpriteRenderManager).
 */
export const ANIMATION_SEQUENCES = {
    /** Default/idle animation */
    DEFAULT: 'default',
    /** Walking/movement animation */
    WALK: 'walk',
    /** Prefix for carry-walk animations, suffixed with material type number */
    CARRY_PREFIX: 'carry_',
    /** Prefix for work animations, suffixed with index (e.g., 'work.0', 'work.1') */
    WORK_PREFIX: 'work.',
} as const;

/**
 * Get the animation sequence key for a carrier carrying a specific material.
 * Returns a key like 'carry_0' (trunk), 'carry_9' (plank), etc.
 */
export function carrySequenceKey(materialType: number): string {
    return `${ANIMATION_SEQUENCES.CARRY_PREFIX}${materialType}`;
}

/**
 * Get the animation sequence key for a work animation variant.
 * Returns a key like 'work.0', 'work.1', etc.
 */
export function workSequenceKey(index: number): string {
    return `${ANIMATION_SEQUENCES.WORK_PREFIX}${index}`;
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

/**
 * Runtime animation state for an entity.
 * Tracks current playback position within an animation.
 */
export interface AnimationState {
    /** Current animation sequence key (e.g., "default", "walk", "work.0") */
    sequenceKey: string;
    /** Current frame index within the sequence */
    currentFrame: number;
    /** Time elapsed in current frame (milliseconds) */
    elapsedMs: number;
    /** Direction index for directional animations (0-5 for units, 0-1 for buildings) */
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
 * Gets the current sprite entry for an animation state.
 * Used by renderer helpers to resolve frame index to actual sprite.
 */
export function getCurrentAnimationSprite(
    state: AnimationState,
    animationData: AnimationData | undefined
): SpriteEntry | null {
    if (!animationData) return null;

    const directionMap = animationData.sequences.get(state.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `Animation sequence '${state.sequenceKey}' not found. Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap.get(state.direction);
    if (!sequence || sequence.frames.length === 0) return null;

    // Use modulo for looping animations (allows unbounded frame counter)
    // Use min for non-looping (clamp to last frame)
    const frameIndex = sequence.loop
        ? state.currentFrame % sequence.frames.length
        : Math.min(state.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex] ?? null;
}

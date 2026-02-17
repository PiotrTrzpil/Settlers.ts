/**
 * Animation sprite resolution helpers for the renderer.
 *
 * These functions resolve AnimationState + AnimationData into concrete SpriteEntry
 * values for rendering. Moved here from systems/animation.ts because they return
 * renderer types (SpriteEntry) and are only used by entity-renderer.ts.
 */

import type { AnimationState, AnimationData } from '../animation';
import type { SpriteEntry } from './sprite-metadata';

/**
 * Gets the current sprite for an animated entity.
 * Falls back to the static sprite if animation data is not available.
 *
 * @param animationState The entity's animation state
 * @param animationData The animation data for this entity type
 * @param fallbackSprite Sprite to use if animation is not available
 */
export function getAnimatedSprite(
    animationState: AnimationState | undefined,
    animationData: AnimationData | undefined,
    fallbackSprite: SpriteEntry | null
): SpriteEntry | null {
    if (!animationState || !animationData) {
        return fallbackSprite;
    }

    const directionMap = animationData.sequences.get(animationState.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `Animation sequence '${animationState.sequenceKey}' not found. Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap.get(animationState.direction);
    if (!sequence || sequence.frames.length === 0) return fallbackSprite;

    const frameIndex = sequence.loop
        ? animationState.currentFrame % sequence.frames.length
        : Math.min(animationState.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex] ?? fallbackSprite;
}

/**
 * Gets the current animation frame sprite for a specific direction.
 * Useful for direction transitions where we need sprites for multiple directions.
 *
 * @param animationState The entity's animation state (for frame index)
 * @param animationData The animation data
 * @param direction The direction to get the sprite for
 * @param fallbackSprite Sprite to use if animation is not available
 */
export function getAnimatedSpriteForDirection(
    animationState: AnimationState,
    animationData: AnimationData | undefined,
    direction: number,
    fallbackSprite: SpriteEntry | null
): SpriteEntry | null {
    if (!animationData) {
        return fallbackSprite;
    }

    const directionMap = animationData.sequences.get(animationState.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `Animation sequence '${animationState.sequenceKey}' not found. Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap?.get(direction);
    if (!sequence || sequence.frames.length === 0) {
        return fallbackSprite;
    }

    // Use modulo for looping animations (allows unbounded frame counter)
    const frameIndex = sequence.loop
        ? animationState.currentFrame % sequence.frames.length
        : Math.min(animationState.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex];
}

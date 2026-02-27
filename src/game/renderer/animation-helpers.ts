/**
 * Animation sprite resolution helpers for the renderer.
 *
 * These functions resolve AnimationPlayback + AnimationData into concrete SpriteEntry
 * values for rendering. Moved here from systems/animation.ts because they return
 * renderer types (SpriteEntry) and are only used by entity-renderer.ts.
 */

import type { AnimationPlayback } from '../animation/entity-visual-service';
import type { AnimationData } from '../animation';
import type { SpriteEntry } from './sprite-metadata';

/**
 * Resolve an animation playback to a concrete sprite frame.
 * Returns null if the sequence/direction is missing — caller provides fallback.
 * Expected for partial sprite data; not an error worth throwing for.
 *
 * @param playback The entity's animation playback state
 * @param animationData The animation data for this entity type
 */
export function resolveAnimationFrame(playback: AnimationPlayback, animationData: AnimationData): SpriteEntry | null {
    const directionMap = animationData.sequences.get(playback.sequenceKey);
    if (!directionMap) return null;

    const sequence = directionMap.get(playback.direction);
    if (!sequence || sequence.frames.length === 0) return null;

    const frameIndex = sequence.loop
        ? playback.currentFrame % sequence.frames.length
        : Math.min(playback.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex] ?? null;
}

/**
 * Gets the current sprite for an animated entity.
 * Falls back to the static sprite if animation data is not available.
 *
 * @param playback The entity's animation playback state
 * @param animationData The animation data for this entity type
 * @param fallbackSprite Sprite to use if animation is not available
 */
export function getAnimatedSprite(
    playback: AnimationPlayback | undefined,
    animationData: AnimationData | undefined,
    fallbackSprite: SpriteEntry | null
): SpriteEntry | null {
    if (!playback || !animationData) {
        return fallbackSprite;
    }

    const directionMap = animationData.sequences.get(playback.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `Animation sequence '${playback.sequenceKey}' not found. Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap.get(playback.direction);
    if (!sequence || sequence.frames.length === 0) return fallbackSprite;

    const frameIndex = sequence.loop
        ? playback.currentFrame % sequence.frames.length
        : Math.min(playback.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex] ?? fallbackSprite;
}

/**
 * Gets the current animation frame sprite for a specific direction.
 * Useful for direction transitions where we need sprites for multiple directions.
 *
 * @param playback The entity's animation playback state (for frame index)
 * @param animationData The animation data
 * @param direction The direction to get the sprite for
 * @param fallbackSprite Sprite to use if animation is not available
 */
export function getAnimatedSpriteForDirection(
    playback: AnimationPlayback,
    animationData: AnimationData | undefined,
    direction: number,
    fallbackSprite: SpriteEntry | null
): SpriteEntry | null {
    if (!animationData) {
        return fallbackSprite;
    }

    const directionMap = animationData.sequences.get(playback.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `Animation sequence '${playback.sequenceKey}' not found. Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap.get(direction);
    if (!sequence || sequence.frames.length === 0) {
        return fallbackSprite;
    }

    // Use modulo for looping animations (allows unbounded frame counter)
    const frameIndex = sequence.loop
        ? playback.currentFrame % sequence.frames.length
        : Math.min(playback.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex]!;
}

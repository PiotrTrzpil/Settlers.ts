/**
 * Animation helper functions for sprite lookup.
 *
 * These functions work with AnimationState from AnimationService
 * and AnimationData from the sprite loading system.
 */

import { EntityType } from '../entity';
import {
    AnimationState,
    AnimationData,
    getCurrentAnimationSprite,
} from '../animation';
import { SpriteEntry } from '../renderer/sprite-metadata';

/**
 * Default direction for each entity type.
 * Buildings use direction 1 (completed state), others use 0.
 */
export const DEFAULT_ANIMATION_DIRECTION: Partial<Record<EntityType, number>> = {
    [EntityType.Building]: 1,
    [EntityType.MapObject]: 0,
    [EntityType.Unit]: 0,
    [EntityType.StackedResource]: 0,
};

/**
 * Unified animation data provider interface.
 * Decouples the animation system from sprite loading/management.
 * Works with any entity type without requiring type-specific methods.
 */
export interface AnimationDataProvider {
    /**
     * Get animation data for any entity type.
     * @param entityType The entity type (Building, Unit, MapObject, etc.)
     * @param subType The specific type within that category (BuildingType, UnitType, etc.)
     */
    getAnimationData(entityType: EntityType, subType: number): AnimationData | null;

    /**
     * Check if an entity type has animation data.
     * @param entityType The entity type
     * @param subType The specific type within that category
     */
    hasAnimation(entityType: EntityType, subType: number): boolean;
}

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

    const sprite = getCurrentAnimationSprite(animationState, animationData);
    return sprite ?? fallbackSprite;
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
        throw new Error(`Animation sequence '${animationState.sequenceKey}' not found. Available: ${[...animationData.sequences.keys()].join(', ')}`);
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


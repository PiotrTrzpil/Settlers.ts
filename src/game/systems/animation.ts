/**
 * Animation system - updates animation states for entities.
 *
 * Provides a unified animation system that works with any entity type.
 * The core animation logic (AnimationState, AnimationData, etc.) is in animation.ts.
 * This module handles entity integration and the provider interface.
 */

import { GameState } from '../game-state';
import { EntityType } from '../entity';
import {
    AnimationState,
    AnimationData,
    ANIMATION_SEQUENCES,
    createAnimationState,
    updateAnimationState,
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
 * Updates animation states for all animated entities.
 * Should be called once per frame (not per tick) for smooth animation.
 *
 * Performance: O(n) where n is entity count. Uses early exits and
 * Map lookups (O(1)) to minimize work per entity.
 *
 * @param gameState The game state containing entities
 * @param deltaMs Time elapsed since last update in milliseconds
 * @param animationProvider Provider for animation data
 */
export function updateAnimations(
    gameState: GameState,
    deltaMs: number,
    animationProvider: AnimationDataProvider | null
): void {
    if (!animationProvider) return;

    for (const entity of gameState.entities) {
        const animState = entity.animationState;

        // Fast path: entity already has animation state
        if (animState) {
            // Get animation data (O(1) map lookup)
            const animationData = animationProvider.getAnimationData(entity.type, entity.subType);
            if (!animationData) continue;

            // Get current sequence and update
            const sequence = animationData.sequences.get(animState.sequenceKey)?.get(animState.direction);
            updateAnimationState(animState, sequence, deltaMs);
            continue;
        }

        // Slow path: check if entity should be animated (runs once per entity)
        if (animationProvider.hasAnimation(entity.type, entity.subType)) {
            const defaultDir = DEFAULT_ANIMATION_DIRECTION[entity.type] ?? 0;
            entity.animationState = createAnimationState(ANIMATION_SEQUENCES.DEFAULT, defaultDir);
            // Auto-play for buildings and map objects (ambient animations)
            if (shouldAutoPlay(entity.type)) {
                entity.animationState.playing = true;
            }
        }
    }
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

    const sequence = animationData.sequences.get(animationState.sequenceKey)?.get(direction);
    if (!sequence || sequence.frames.length === 0) {
        return fallbackSprite;
    }

    const frameIndex = Math.min(animationState.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex];
}

/**
 * Check if an entity type should auto-play animations.
 * Buildings and MapObjects animate continuously.
 * Units are controlled by movement events.
 */
function shouldAutoPlay(entityType: EntityType): boolean {
    return entityType === EntityType.Building || entityType === EntityType.MapObject;
}

/**
 * Initializes animation state for an entity if it should be animated.
 * Call this when adding new entities to the game.
 */
export function initializeEntityAnimation(
    entity: { type: EntityType; subType: number; animationState?: AnimationState },
    animationProvider: AnimationDataProvider | null
): void {
    if (!animationProvider) return;

    if (animationProvider.hasAnimation(entity.type, entity.subType)) {
        const defaultDir = DEFAULT_ANIMATION_DIRECTION[entity.type] ?? 0;
        entity.animationState = createAnimationState(ANIMATION_SEQUENCES.DEFAULT, defaultDir);
        // Auto-play for buildings and map objects (ambient animations)
        if (shouldAutoPlay(entity.type)) {
            entity.animationState.playing = true;
        }
    }
}

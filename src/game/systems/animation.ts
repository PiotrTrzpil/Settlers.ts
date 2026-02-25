/**
 * Animation helper functions for sprite lookup.
 *
 * The sprite-resolution functions (getAnimatedSprite, getAnimatedSpriteForDirection)
 * have been moved to renderer/animation-helpers.ts since they return renderer types
 * (SpriteEntry) and are only used by entity-renderer.ts.
 *
 * This file re-exports them for backward compatibility and retains the
 * non-renderer types (DEFAULT_ANIMATION_DIRECTION, AnimationDataProvider).
 */

import { EntityType } from '../entity';
import type { AnimationData } from '../animation';

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
     * @param race Optional race (Race enum value) for race-specific animations
     */
    getAnimationData(entityType: EntityType, subType: number, race: number): AnimationData | null;

    /**
     * Check if an entity type has animation data.
     * @param entityType The entity type
     * @param subType The specific type within that category
     * @param race Race enum value for race-specific animations
     */
    hasAnimation(entityType: EntityType, subType: number, race: number): boolean;
}

// Re-export sprite resolution functions from their canonical location in the renderer module
export { getAnimatedSprite, getAnimatedSpriteForDirection } from '../renderer/animation-helpers';

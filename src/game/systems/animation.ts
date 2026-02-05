/**
 * Animation system - updates animation states for entities.
 */

import { GameState } from '../game-state';
import { EntityType, BuildingType, MapObjectType } from '../entity';
import {
    AnimationState,
    AnimationData,
    createAnimationState,
    updateAnimationState,
    getCurrentAnimationSprite,
} from '../animation';
import { SpriteEntry } from '../renderer/sprite-metadata';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('AnimationSystem');

/**
 * Animation data provider interface.
 * Used to decouple the animation system from the sprite render manager.
 */
export interface AnimationDataProvider {
    /** Get animation data for a building type */
    getBuildingAnimationData(type: BuildingType): AnimationData | null;
    /** Get animation data for a map object type */
    getMapObjectAnimationData(type: MapObjectType): AnimationData | null;
    /** Check if building has animation */
    hasBuildingAnimation(type: BuildingType): boolean;
    /** Check if map object has animation */
    hasMapObjectAnimation(type: MapObjectType): boolean;
}

/**
 * Updates animation states for all animated entities.
 * Should be called once per frame (not per tick) for smooth animation.
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
        // Skip entities without animation state
        if (!entity.animationState) {
            // Initialize animation state for entities that should be animated
            if (entity.type === EntityType.Building) {
                const buildingType = entity.subType as BuildingType;
                if (animationProvider.hasBuildingAnimation(buildingType)) {
                    entity.animationState = createAnimationState('default', 1);
                }
            } else if (entity.type === EntityType.MapObject) {
                const mapObjectType = entity.subType as MapObjectType;
                if (animationProvider.hasMapObjectAnimation(mapObjectType)) {
                    entity.animationState = createAnimationState('default', 0);
                }
            }
            continue;
        }

        // Get animation data for this entity
        let animationData: AnimationData | null = null;

        if (entity.type === EntityType.Building) {
            animationData = animationProvider.getBuildingAnimationData(entity.subType as BuildingType);
        } else if (entity.type === EntityType.MapObject) {
            animationData = animationProvider.getMapObjectAnimationData(entity.subType as MapObjectType);
        }

        if (!animationData) continue;

        // Get current sequence
        const directionMap = animationData.sequences.get(entity.animationState.sequenceKey);
        const sequence = directionMap?.get(entity.animationState.direction);

        // Update animation state
        updateAnimationState(entity.animationState, sequence, deltaMs);
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
 * Initializes animation state for an entity if it should be animated.
 * Call this when adding new entities to the game.
 */
export function initializeEntityAnimation(
    entity: { type: EntityType; subType: number; animationState?: AnimationState },
    animationProvider: AnimationDataProvider | null
): void {
    if (!animationProvider) return;

    if (entity.type === EntityType.Building) {
        const buildingType = entity.subType as BuildingType;
        if (animationProvider.hasBuildingAnimation(buildingType)) {
            entity.animationState = createAnimationState('default', 1);
        }
    } else if (entity.type === EntityType.MapObject) {
        const mapObjectType = entity.subType as MapObjectType;
        if (animationProvider.hasMapObjectAnimation(mapObjectType)) {
            entity.animationState = createAnimationState('default', 0);
        }
    }
}

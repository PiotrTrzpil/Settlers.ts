/**
 * Animation sprite resolution helpers for the renderer.
 *
 * These functions resolve AnimationPlayback + AnimationData into concrete SpriteEntry
 * values for rendering. Moved here from systems/animation.ts because they return
 * renderer types (SpriteEntry) and are only used by entity-renderer.ts.
 */

import type { AnimationPlayback } from '../animation/entity-visual-service';
import type { AnimationData } from '../animation/animation';
import type { SpriteEntry } from './sprite-metadata';
import { EntityType } from '../entity';
import { UnitType } from '../core/unit-types';
import { BuildingType } from '../buildings/building-type';
import { createLogger } from '@/utilities/logger';

const log = createLogger('AnimationHelpers');

/** Track already-warned animation misses to avoid per-frame spam. */
const warnedAnimKeys = new Set<string>();

function warnOnce(key: string, msg: () => string): void {
    if (warnedAnimKeys.has(key)) return;
    warnedAnimKeys.add(key);
    log.warn(msg());
}

function entityLabel(entityType: EntityType, subType: number): string {
    switch (entityType) {
    case EntityType.Unit:
        return `Unit/${UnitType[subType] ?? subType}`;
    case EntityType.Building:
        return `Building/${BuildingType[subType] ?? subType}`;
    case EntityType.None:
    case EntityType.MapObject:
    case EntityType.StackedPile:
    case EntityType.Decoration:
        return `${EntityType[entityType]}/${subType}`;
    }
}

/**
 * Unified animation data provider interface.
 * Decouples animation consumers from the sprite loading/management implementation.
 */
export interface AnimationDataProvider {
    getAnimationData(entityType: EntityType, subType: number, race: number): AnimationData | null;
    hasAnimation(entityType: EntityType, subType: number, race: number): boolean;
}

/**
 * Resolve an animation playback to a concrete sprite frame.
 * Returns null if the sequence/direction is missing — caller provides fallback.
 * Warns once per unknown sequence key to catch typos (e.g., 'idle' vs 'default').
 *
 * @param playback The entity's animation playback state
 * @param animationData The animation data for this entity type
 */
export function resolveAnimationFrame(
    playback: AnimationPlayback,
    animationData: AnimationData,
    eType?: EntityType,
    eSubType?: number
): SpriteEntry | null {
    const label = eType !== undefined && eSubType !== undefined ? entityLabel(eType, eSubType) : 'unknown';
    const directionMap = animationData.sequences.get(playback.sequenceKey);

    if (!directionMap) {
        warnOnce(
            `seq:${label}:${playback.sequenceKey}`,
            () =>
                `[${label}] Unknown animation sequence '${playback.sequenceKey}'. ` +
                `Available: [${[...animationData.sequences.keys()].join(', ')}]`
        );
        return null;
    }

    const sequence = directionMap.get(playback.direction);
    if (!sequence || sequence.frames.length === 0) {
        warnOnce(
            `dir:${label}:${playback.sequenceKey}:${playback.direction}`,
            () =>
                `[${label}] No frames for sequence '${playback.sequenceKey}' direction ${playback.direction}. ` +
                `Available directions: [${[...directionMap.keys()].join(', ')}]`
        );
        return null;
    }

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
    fallbackSprite: SpriteEntry | null,
    eType?: EntityType,
    eSubType?: number
): SpriteEntry | null {
    if (!playback || !animationData) {
        return fallbackSprite;
    }

    const label = eType !== undefined && eSubType !== undefined ? entityLabel(eType, eSubType) : 'unknown';
    const directionMap = animationData.sequences.get(playback.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `[${label}] Animation sequence '${playback.sequenceKey}' not found. ` +
                `Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap.get(playback.direction);
    if (!sequence || sequence.frames.length === 0) {
        warnOnce(
            `dir:${label}:${playback.sequenceKey}:${playback.direction}`,
            () =>
                `[${label}] No frames for sequence '${playback.sequenceKey}' direction ${playback.direction}. ` +
                `Available directions: [${[...directionMap.keys()].join(', ')}]`
        );
        return fallbackSprite;
    }

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
    fallbackSprite: SpriteEntry | null,
    eType?: EntityType,
    eSubType?: number
): SpriteEntry | null {
    if (!animationData) {
        return fallbackSprite;
    }

    const label = eType !== undefined && eSubType !== undefined ? entityLabel(eType, eSubType) : 'unknown';
    const directionMap = animationData.sequences.get(playback.sequenceKey);
    if (!directionMap) {
        throw new Error(
            `[${label}] Animation sequence '${playback.sequenceKey}' not found. ` +
                `Available: ${[...animationData.sequences.keys()].join(', ')}`
        );
    }

    const sequence = directionMap.get(direction);
    if (!sequence || sequence.frames.length === 0) {
        warnOnce(
            `dir:${label}:${playback.sequenceKey}:${direction}`,
            () =>
                `[${label}] No frames for sequence '${playback.sequenceKey}' direction ${direction}. ` +
                `Available directions: [${[...directionMap.keys()].join(', ')}]`
        );
        return fallbackSprite;
    }

    // Use modulo for looping animations (allows unbounded frame counter)
    const frameIndex = sequence.loop
        ? playback.currentFrame % sequence.frames.length
        : Math.min(playback.currentFrame, sequence.frames.length - 1);
    return sequence.frames[frameIndex]!;
}

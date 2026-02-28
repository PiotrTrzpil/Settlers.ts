/**
 * Animation types, constants, and sprite lookup.
 *
 * This file defines the shared contract between:
 * - EntityVisualService (owns runtime visual + animation state)
 * - AnimationResolver (derives intent from entity state)
 * - SpriteRenderManager (registers animation data)
 * - EntityRenderer (looks up sprites per frame)
 */

import type { SpriteEntry } from './renderer/sprite-metadata';

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
    /** Prefix for pickup animations, suffixed with index (e.g., 'pickup.0') */
    PICKUP_PREFIX: 'pickup.',
    /** Prefix for fight animations, suffixed with index (e.g., 'fight.0') */
    FIGHT_PREFIX: 'fight.',
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
 * Get the animation sequence key for a pickup animation variant.
 *
 * Material-specific: `pickupSequenceKey('coal')` → `'pickup.coal'`
 * Generic fallback:  `pickupSequenceKey(0)` → `'pickup.0'`
 */
export function pickupSequenceKey(variant: string | number): string {
    return `${ANIMATION_SEQUENCES.PICKUP_PREFIX}${variant}`;
}

/**
 * Get the animation sequence key for a fight animation variant.
 * Returns a key like 'fight.0'.
 */
export function fightSequenceKey(index: number): string {
    return `${ANIMATION_SEQUENCES.FIGHT_PREFIX}${index}`;
}

/**
 * Get the level-specific idle sequence key.
 * Level 1 uses 'default' (the base idle); levels 2-3 use 'default.2', 'default.3'.
 */
export function levelIdleSequenceKey(level: number): string {
    return level <= 1 ? ANIMATION_SEQUENCES.DEFAULT : `${ANIMATION_SEQUENCES.DEFAULT}.${level}`;
}

/**
 * Get the level-specific walk sequence key.
 * Level 1 uses 'walk' (the base walk); levels 2-3 use 'walk.2', 'walk.3'.
 */
export function levelWalkSequenceKey(level: number): string {
    return level <= 1 ? ANIMATION_SEQUENCES.WALK : `${ANIMATION_SEQUENCES.WALK}.${level}`;
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
 * Complete animation data for an entity type.
 * Maps sequence names to their definitions per direction.
 */
export interface AnimationData {
    /** Map of sequence key -> direction -> animation sequence */
    sequences: Map<string, Map<number, AnimationSequence>>;
    /** Default sequence key to use */
    defaultSequence: string;
}

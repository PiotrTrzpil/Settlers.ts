/**
 * Animation types, constants, and sprite lookup.
 *
 * This file defines the shared contract between:
 * - EntityVisualService (owns runtime visual + animation state)
 * - AnimationResolver (derives intent from entity state)
 * - SpriteRenderManager (registers animation data)
 * - EntityRenderer (looks up sprites per frame)
 *
 * Sequence keys are XML jobPart names (e.g., WC_WALK, WC_CUT_TREE, BA_WALK_FLOUR).
 * The XML prefix identifies the unit type, the suffix identifies the action.
 */

import type { SpriteEntry } from '../renderer/sprite-metadata';

/**
 * Build an XML sequence key from a unit's XML prefix and an action suffix.
 * E.g., xmlKey('WC', 'WALK') → 'WC_WALK', xmlKey('BML01', 'FIGHT') → 'BML01_FIGHT'.
 */
export function xmlKey(prefix: string, action: string): string {
    return `${prefix}_${action}`;
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

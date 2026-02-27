/**
 * Shared types for sprite metadata categories.
 *
 * @module renderer/sprite-metadata/types
 */

import { AtlasRegion } from '../entity-texture-atlas';
import type { AnimationData } from '@/game/animation';

/**
 * Metadata for a single sprite entry in the atlas.
 * Contains both atlas coordinates and world-space sizing.
 */
export interface SpriteEntry {
    /** UV coordinates and pixel position in the atlas */
    atlasRegion: AtlasRegion;
    /** Drawing offset X from GfxImage.left, in world units */
    offsetX: number;
    /** Drawing offset Y from GfxImage.top, in world units */
    offsetY: number;
    /** Sprite width in world-space units */
    widthWorld: number;
    /** Sprite height in world-space units */
    heightWorld: number;
    /**
     * Base offset into combined palette texture for this sprite's GFX file.
     * Added to sprite's relative palette indices in the shader.
     */
    paletteBaseOffset: number;
}

/**
 * Animation entry containing sequence data for animated sprites.
 */
export interface AnimatedSpriteEntry {
    /** Static sprite (first frame) for non-animated rendering */
    staticSprite: SpriteEntry;
    /** Full animation data with all frames */
    animationData: AnimationData;
    /** Whether this sprite has multiple frames */
    isAnimated: boolean;
}

/**
 * Generic sprite category interface.
 * Each category manages a specific domain of sprites with its own key type.
 */
export interface ISpriteCategory<K> {
    get(key: K): SpriteEntry | null;
    set(key: K, entry: SpriteEntry): void;
    clear(): void;
}

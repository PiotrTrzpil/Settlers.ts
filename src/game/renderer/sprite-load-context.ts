/**
 * Shared context for all sprite loading operations.
 *
 * Every sprite loader needs the same core dependencies: a SpriteLoader to decode
 * images, an atlas to pack into, a registry to register metadata, a GL context
 * for GPU uploads, and a palette manager for color lookup.
 *
 * Individual loaders may need additional parameters (race, manifest, etc.)
 * but this base context eliminates the repeated (atlas, registry, gl, ctx) tuples
 * that were passed separately to every loader.
 */

import type { SpriteLoader } from './sprite-loader';
import type { EntityTextureAtlas } from './entity-texture-atlas';
import type { SpriteMetadataRegistry } from './sprite-metadata';
import type { PaletteTextureManager } from './palette-texture';

export interface SpriteLoadContext {
    readonly spriteLoader: SpriteLoader;
    readonly atlas: EntityTextureAtlas;
    readonly registry: SpriteMetadataRegistry;
    readonly gl: WebGL2RenderingContext;
    readonly paletteManager: PaletteTextureManager;
}

/**
 * Get palette base offset for a GFX file, defaulting to 0 if unregistered.
 * Replaces the old `getPaletteBaseOffset` callback that each loader carried.
 */
export function getPaletteBase(ctx: SpriteLoadContext, fileId: string): number {
    const offset = ctx.paletteManager.getBaseOffset(fileId);
    return offset >= 0 ? offset : 0;
}

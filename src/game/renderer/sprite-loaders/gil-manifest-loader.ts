/**
 * Generic GIL sprite loading — shared utilities for loading sprites by direct GIL index.
 *
 * Two entry points:
 * - `loadGilManifest`: standalone — loads, registers, and GPU-uploads sprites for a GilSpriteManifest
 * - `loadGilSpriteBatch`: low-level — loads sprites from an already-open file set
 *
 * `loadGilManifest` registers sprites into the overlay category so that
 * `manifest.resolve(gilIndex, registry)` works at render time.
 */

import type { SpriteEntry } from '../sprite-metadata/types';
import type { GilSpriteManifest } from '../sprite-metadata/gil-sprite-manifest';
import type { SpriteLoadContext, FileLoadContext } from '../sprite-load-context';
import type { SpriteTrim } from '../sprite-loader';

/**
 * Load and register all sprites declared in a GilSpriteManifest.
 * Handles file set loading, palette registration, GPU upload, and overlay registration.
 * After this call, `manifest.resolve(gilIndex, registry)` will return the loaded sprites.
 *
 * @returns Number of sprites successfully loaded.
 */
export async function loadGilManifest(manifest: GilSpriteManifest, ctx: SpriteLoadContext): Promise<number> {
    const gfxFileId = String(manifest.gfxFile);

    const fileSet = await ctx.spriteLoader.loadFileSet(gfxFileId);
    if (!fileSet) {
        return 0;
    }

    let paletteBase = ctx.paletteManager.getBaseOffset(gfxFileId);
    if (paletteBase < 0) {
        const paletteData = fileSet.paletteCollection.getPalette().getData();
        paletteBase = ctx.paletteManager.registerPalette(gfxFileId, paletteData);
    }

    const fileCtx: FileLoadContext = { ...ctx, fileSet, paletteBase };
    const sprites = await loadGilSpriteBatch(manifest.gilIndices, fileCtx, manifest.trim);

    for (const [gilIndex, entry] of sprites) {
        ctx.registry.registerOverlayFrames(manifest.gfxFile, gilIndex, 0, [entry]);
    }

    return sprites.size;
}

/**
 * Load sprites for a batch of GIL indices from an already-loaded file set.
 * Uses combined parse+decode worker for batch efficiency.
 * Uploads to GPU after all sprites are packed, then returns loaded entries.
 */
export async function loadGilSpriteBatch(
    gilIndices: readonly number[],
    ctx: FileLoadContext,
    trim?: SpriteTrim
): Promise<Map<number, SpriteEntry>> {
    const { fileSet, spriteLoader, atlas, gl, paletteBase } = ctx;
    const loaded = await spriteLoader.loadDirectSpriteBatch(fileSet, gilIndices, null, atlas, paletteBase, trim);

    const result = new Map<number, SpriteEntry>();
    for (const [gilIndex, sprite] of loaded) {
        result.set(gilIndex, sprite.entry);
    }

    if (result.size > 0) {
        atlas.update(gl);
    }

    return result;
}

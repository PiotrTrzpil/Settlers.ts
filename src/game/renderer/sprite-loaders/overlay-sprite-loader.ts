/**
 * Overlay sprite loading — job-specific overlays requested at runtime.
 * Extracted from SpriteRenderManager to keep file size under the max-lines limit.
 */

import type { SpriteLoadContext } from '../sprite-load-context';

/**
 * Load overlay sprites into the atlas.
 *
 * Call after building sprites are loaded (setRace / init). Accepts a manifest
 * of (gfxFile, jobIndex, directionIndex) tuples — typically produced by
 * OverlayRegistry.getSpriteManifest().
 *
 * @returns Number of overlay sprite sets successfully loaded.
 */
export async function loadOverlaySprites(
    manifest: readonly { gfxFile: number; jobIndex: number; directionIndex?: number }[],
    ctx: SpriteLoadContext
): Promise<number> {
    // Deduplicate by key
    const seen = new Set<string>();
    const unique: { gfxFile: number; jobIndex: number; directionIndex: number }[] = [];
    for (const entry of manifest) {
        const dir = entry.directionIndex ?? 0;
        const key = `${entry.gfxFile}:${entry.jobIndex}:${dir}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push({ gfxFile: entry.gfxFile, jobIndex: entry.jobIndex, directionIndex: dir });
    }

    // Preload all unique GFX files in parallel before decoding.
    const uniqueFileIds = [...new Set(unique.map(e => String(e.gfxFile)))];
    await Promise.all(uniqueFileIds.map(id => ctx.spriteLoader.loadFileSet(id)));

    // Decode all overlay animations in parallel. loadFileSet is cached so the
    // second call per entry is synchronous. Atlas packing is synchronous (no awaits
    // inside), so concurrent packing is safe on the single JS thread.
    const counts = await Promise.all(
        unique.map(async entry => {
            const fileSet = await ctx.spriteLoader.loadFileSet(String(entry.gfxFile));
            if (!fileSet) {
                return 0;
            }

            const paletteBase = ctx.paletteManager.getBaseOffset(String(entry.gfxFile));
            const anim = await ctx.spriteLoader.loadJobAnimation(
                fileSet,
                entry.jobIndex,
                entry.directionIndex,
                ctx.atlas,
                paletteBase
            );
            if (anim && anim.frames.length > 0) {
                ctx.registry.registerOverlayFrames(
                    entry.gfxFile,
                    entry.jobIndex,
                    entry.directionIndex,
                    anim.frames.map(f => f.entry)
                );
                return 1;
            }
            // Try single frame
            const sprite = await ctx.spriteLoader.loadJobSprite(
                fileSet,
                { jobIndex: entry.jobIndex, directionIndex: entry.directionIndex },
                ctx.atlas,
                paletteBase
            );
            if (sprite) {
                ctx.registry.registerOverlayFrames(entry.gfxFile, entry.jobIndex, entry.directionIndex, [sprite.entry]);
                return 1;
            }
            return 0;
        })
    );

    const loaded = counts.reduce<number>((sum, n) => sum + n, 0);
    if (loaded > 0) {
        ctx.atlas.update(ctx.gl);
    }

    return loaded;
}

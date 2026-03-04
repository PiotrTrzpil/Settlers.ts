/**
 * Resource (material) sprite loading — carried goods like logs, boards, food, tools.
 * Extracted from SpriteRenderManager to keep file size under the max-lines limit.
 */

import { SpriteEntry, GFX_FILE_NUMBERS, getResourceSpriteMap } from '../sprite-metadata';
import { SafeLoadBatch } from '../batch-loader';
import { EMaterialType } from '@/game/economy';
import { type SpriteLoadContext, getPaletteBase } from '../sprite-load-context';

/**
 * Load resource sprites (carried materials) using SafeLoadBatch pattern.
 * Returns true if any resource sprites were loaded.
 */
export async function loadGoodSprites(ctx: SpriteLoadContext): Promise<boolean> {
    const fileId = `${GFX_FILE_NUMBERS.RESOURCES}`;
    const fileSet = await ctx.spriteLoader.loadFileSet(fileId);
    if (!fileSet?.jilReader || !fileSet.dilReader) return false;

    const paletteBase = getPaletteBase(ctx, fileId);

    type ResourceData = { type: EMaterialType; dir: number; entry: SpriteEntry };
    const batch = new SafeLoadBatch<ResourceData>();

    for (const [typeStr, info] of Object.entries(getResourceSpriteMap())) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
        if (!info) continue;
        const type = Number(typeStr) as EMaterialType;

        const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, info.index, ctx.atlas, paletteBase);
        if (!loadedDirs) continue;

        for (const [dir, sprites] of loadedDirs) {
            if (sprites.length > 0) {
                batch.add({ type, dir, entry: sprites[0]!.entry });
            }
        }
    }

    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerGood(data.type, data.dir, data.entry);
    });

    return batch.count > 0;
}

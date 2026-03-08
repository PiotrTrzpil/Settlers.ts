/**
 * Crop sprite loading — grain, sunflower, agave, beehive.
 * Extracted from SpriteRenderManager to keep file size under the max-lines limit.
 */

import { EntityType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { ANIMATION_DEFAULTS } from '../animation/animation';
import { CROP_SPRITE_CONFIGS } from '../features/crops/crop-system';
import { SafeLoadBatch } from './batch-loader';
import type { EntityTextureAtlas } from './entity-texture-atlas';
import type { SpriteEntry, SpriteMetadataRegistry } from './sprite-metadata';
import type { SpriteLoader, LoadedGfxFileSet } from './sprite-loader';

type CropData = {
    cropType: MapObjectType;
    variation: number;
    firstFrame: SpriteEntry;
    allFrames: SpriteEntry[] | null;
};

/**
 * Load crop sprites (grain, sunflower, agave, beehive) using direct GIL indices.
 * Each crop type has growing variations (static), a mature animation, and a harvested sprite.
 * Variation layout per crop type: 0..growingCount-1 = growing, growingCount = mature, growingCount+1 = harvested.
 */
export async function loadCropSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number
): Promise<number> {
    let totalLoaded = 0;

    for (const [cropType, config] of CROP_SPRITE_CONFIGS) {
        const batch = new SafeLoadBatch<CropData>();

        // Growing stages (static sprites)
        for (let i = 0; i < config.growingSprites.length; i++) {
            const sprite = await spriteLoader.loadDirectSprite(
                fileSet,
                config.growingSprites[i]!,
                null,
                atlas,
                paletteBaseOffset
            );
            if (sprite) {
                batch.add({ cropType, variation: i, firstFrame: sprite.entry, allFrames: null });
            }
        }

        // Mature sprite (animated)
        const matureFrames: SpriteEntry[] = [];
        for (let f = 0; f < config.matureSprite.count; f++) {
            const sprite = await spriteLoader.loadDirectSprite(
                fileSet,
                config.matureSprite.start + f,
                null,
                atlas,
                paletteBaseOffset
            );
            if (sprite) matureFrames.push(sprite.entry);
        }
        if (matureFrames.length > 0) {
            batch.add({
                cropType,
                variation: config.growingSprites.length,
                firstFrame: matureFrames[0]!,
                allFrames: matureFrames,
            });
        }

        // Harvested sprite (static)
        const harvested = await spriteLoader.loadDirectSprite(
            fileSet,
            config.harvestedSprite,
            null,
            atlas,
            paletteBaseOffset
        );
        if (harvested) {
            batch.add({
                cropType,
                variation: config.growingSprites.length + 1,
                firstFrame: harvested.entry,
                allFrames: null,
            });
        }

        batch.finalize(atlas, gl, data => {
            registry.registerMapObject(data.cropType, data.firstFrame, data.variation);
            if (data.allFrames) {
                registry.registerAnimatedEntity(
                    EntityType.MapObject,
                    data.cropType,
                    new Map([[0, data.allFrames]]),
                    ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                    true
                );
            }
            totalLoaded++;
        });

        await new Promise(r => setTimeout(r, 0));
    }

    return totalLoaded;
}

/**
 * Map-object sprite loading — trees, stones, decorations, flags, territory dots, resource deposits.
 * Extracted from SpriteRenderManager to keep file size under the max-lines limit.
 */

import { LogHandler } from '@/utilities/log-handler';
import {
    SpriteEntry,
    GFX_FILE_NUMBERS,
    getMapObjectSpriteMap,
    MAP_OBJECT_SPRITES,
    TREE_JOB_OFFSET,
    TREE_JOB_INDICES,
    TREE_JOBS_PER_TYPE,
} from '../sprite-metadata';
import { ANIMATION_DEFAULTS } from '@/game/animation/animation';
import type { LoadedGfxFileSet } from '../sprite-loader';
import { SafeLoadBatch } from '../batch-loader';
import { EntityType } from '@/game/entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { STONE_DEPLETION_STAGES } from '@/game/features/stones/stone-system';
import { buildDecorationSpriteMap } from '../decoration-sprite-map';
import { loadCropSprites } from '../sprite-crop-loader';
import { loadGilSpriteBatch } from './gil-manifest-loader';
import { type SpriteLoadContext, getPaletteBase } from '../sprite-load-context';

const log = new LogHandler('MapObjectsSpriteLoader');

/** Pre-resolved context for sub-loaders operating on a single GFX file. */
interface FileCtx extends SpriteLoadContext {
    fileSet: LoadedGfxFileSet;
    paletteBase: number;
}

// =============================================================================
// Tree sprites
// =============================================================================

/** Load all variant sprites for a single tree type. */
async function loadTreeTypeSprites(ctx: FileCtx, treeType: MapObjectType, variantBases: number[]): Promise<number> {
    type TreeStageData = {
        treeType: MapObjectType;
        variation: number;
        variantIndex: number;
        firstFrame: SpriteEntry;
        allFrames: SpriteEntry[] | null;
    };

    let loaded = 0;
    const swayFrames = new Map<number, SpriteEntry[]>();
    const batch = new SafeLoadBatch<TreeStageData>();

    for (let v = 0; v < variantBases.length; v++) {
        const baseJob = variantBases[v]!;

        for (let offset = 0; offset <= 10; offset++) {
            const anim = await ctx.spriteLoader.loadJobAnimation(
                ctx.fileSet,
                baseJob + offset,
                0,
                ctx.atlas,
                ctx.paletteBase
            );
            if (anim?.frames.length) {
                const isNormal = offset === TREE_JOB_OFFSET.NORMAL;
                batch.add({
                    treeType,
                    variation: v * TREE_JOBS_PER_TYPE + offset,
                    variantIndex: v,
                    firstFrame: anim.frames[0]!.entry,
                    allFrames: isNormal ? anim.frames.map(f => f.entry) : null,
                });
            }
        }
    }

    // GPU upload → register all variants for this tree type
    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerMapObject(data.treeType, data.firstFrame, data.variation);
        if (data.allFrames) {
            swayFrames.set(data.variantIndex, data.allFrames);
        }
        loaded++;
    });

    // Register single animation entry — variant encoded as direction
    if (swayFrames.size > 0) {
        ctx.registry.registerAnimatedEntity(
            EntityType.MapObject,
            treeType,
            swayFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            true
        );
    }

    return loaded;
}

/**
 * Load tree sprites using JIL/DIL structure.
 * Trees have: D0-D2 = growth stages, D3 = normal (with sway animation), D4 = falling, D5 = canopy disappearing.
 */
async function loadTreeSprites(ctx: FileCtx): Promise<number> {
    if (!ctx.fileSet.jilReader || !ctx.fileSet.dilReader) {
        log.debug('Tree JIL/DIL not available, skipping tree loading');
        return 0;
    }

    let totalLoaded = 0;

    for (const [typeStr, variantBases] of Object.entries(TREE_JOB_INDICES)) {
        if (!Array.isArray(variantBases)) continue;
        const treeType = Number(typeStr) as MapObjectType;
        totalLoaded += await loadTreeTypeSprites(ctx, treeType, variantBases);
        await new Promise(r => setTimeout(r, 0));
    }

    return totalLoaded;
}

// =============================================================================
// Stone sprites
// =============================================================================

/**
 * Load harvestable stone depletion sprites from direct GIL indices.
 * 2 variants (A, B) × 13 stages = 26 sprites for ResourceStone.
 * Variation layout: variant * 13 + stage (A: 0-12, B: 13-25).
 */
async function loadStoneSprites(ctx: FileCtx): Promise<number> {
    const variants = [MAP_OBJECT_SPRITES.STONE_STAGES_A, MAP_OBJECT_SPRITES.STONE_STAGES_B];

    // Collect all GIL indices across both variants
    const allIndices: number[] = [];
    for (const range of variants) {
        for (let s = 0; s < range.count; s++) allIndices.push(range.start + s);
    }

    const sprites = await loadGilSpriteBatch(
        allIndices,
        ctx.fileSet,
        ctx.spriteLoader,
        ctx.atlas,
        ctx.gl,
        ctx.paletteBase
    );

    let loaded = 0;
    for (let v = 0; v < variants.length; v++) {
        const range = variants[v]!;
        for (let stage = 0; stage < range.count; stage++) {
            const entry = sprites.get(range.start + stage);
            if (entry) {
                ctx.registry.registerMapObject(MapObjectType.ResourceStone, entry, v * STONE_DEPLETION_STAGES + stage);
                loaded++;
            }
        }
    }

    return loaded;
}

// =============================================================================
// Decoration sprites
// =============================================================================

/**
 * Load decoration sprites (non-tree map objects) using direct GIL indices.
 * Deduplicates by GIL index so each unique sprite is loaded once,
 * then registered for all entity keys that share it.
 */
async function loadDecorationSprites(ctx: FileCtx): Promise<number> {
    const decoMap = buildDecorationSpriteMap();

    // Group entity keys by gilIndex — avoids loading the same sprite twice
    const byGilIndex = new Map<number, number[]>();
    for (const [entityKey, ref] of decoMap) {
        const existing = byGilIndex.get(ref.gilIndex);
        if (existing) {
            existing.push(entityKey);
        } else {
            byGilIndex.set(ref.gilIndex, [entityKey]);
        }
    }

    const sprites = await loadGilSpriteBatch(
        [...byGilIndex.keys()],
        ctx.fileSet,
        ctx.spriteLoader,
        ctx.atlas,
        ctx.gl,
        ctx.paletteBase
    );

    let totalRegistered = 0;
    for (const [gilIndex, entityKeys] of byGilIndex) {
        const entry = sprites.get(gilIndex);
        if (!entry) continue;
        for (const key of entityKeys) {
            ctx.registry.registerMapObject(key as MapObjectType, entry);
            totalRegistered++;
        }
    }

    return totalRegistered;
}

// =============================================================================
// Flag sprites
// =============================================================================

/**
 * Load small animated flag sprites (8 player colors × 24 frames).
 * Flags are loaded from MAP_OBJECT_SPRITES in the landscape GFX file (5.gfx).
 */
async function loadFlagSprites(ctx: FileCtx): Promise<number> {
    const FLAG_RANGES = [
        MAP_OBJECT_SPRITES.FLAG_SMALL_RED,
        MAP_OBJECT_SPRITES.FLAG_SMALL_BLUE,
        MAP_OBJECT_SPRITES.FLAG_SMALL_GREEN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_YELLOW,
        MAP_OBJECT_SPRITES.FLAG_SMALL_PURPLE,
        MAP_OBJECT_SPRITES.FLAG_SMALL_ORANGE,
        MAP_OBJECT_SPRITES.FLAG_SMALL_TEAL,
        MAP_OBJECT_SPRITES.FLAG_SMALL_WHITE,
    ];

    // Collect all GIL indices across all player colors
    const allIndices: number[] = [];
    for (const range of FLAG_RANGES) {
        for (let f = 0; f < range.count; f++) allIndices.push(range.start + f);
    }

    const sprites = await loadGilSpriteBatch(
        allIndices,
        ctx.fileSet,
        ctx.spriteLoader,
        ctx.atlas,
        ctx.gl,
        ctx.paletteBase
    );

    let loaded = 0;
    for (let playerIndex = 0; playerIndex < FLAG_RANGES.length; playerIndex++) {
        const range = FLAG_RANGES[playerIndex]!;
        for (let frame = 0; frame < range.count; frame++) {
            const entry = sprites.get(range.start + frame);
            if (entry) {
                ctx.registry.registerFlag(playerIndex, frame, entry);
                loaded++;
            }
        }
    }

    return loaded;
}

// =============================================================================
// Territory dot sprites
// =============================================================================

/**
 * Load territory dot sprites (8 player colors) from direct GIL indices.
 */
async function loadTerritoryDotSprites(ctx: FileCtx): Promise<number> {
    const DOT_GIL_INDICES = [
        MAP_OBJECT_SPRITES.TERRITORY_DOT_RED,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_BLUE,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_GREEN,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_YELLOW,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_PURPLE,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_ORANGE,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_TEAL,
        MAP_OBJECT_SPRITES.TERRITORY_DOT_GRAY,
    ];

    const sprites = await loadGilSpriteBatch(
        DOT_GIL_INDICES,
        ctx.fileSet,
        ctx.spriteLoader,
        ctx.atlas,
        ctx.gl,
        ctx.paletteBase
    );

    let loaded = 0;
    for (let playerIndex = 0; playerIndex < DOT_GIL_INDICES.length; playerIndex++) {
        const entry = sprites.get(DOT_GIL_INDICES[playerIndex]!);
        if (entry) {
            ctx.registry.registerTerritoryDot(playerIndex, entry);
            loaded++;
        } else {
            console.warn(
                `[loadTerritoryDotSprites] GIL ${DOT_GIL_INDICES[playerIndex]} (player ${playerIndex}) returned null`
            );
        }
    }

    if (loaded === 0) {
        console.warn('[loadTerritoryDotSprites] No territory dot sprites loaded from GIL 1850-1857');
    }

    return loaded;
}

// =============================================================================
// Resource map objects (coal, iron, gold, stone deposits)
// =============================================================================

/**
 * Load resource map objects (coal, iron, gold, stone, sulfur deposits).
 */
async function loadResourceMapObjects(ctx: FileCtx): Promise<number> {
    const mapObjectSpriteMap = getMapObjectSpriteMap();
    let loadedCount = 0;

    for (const [typeStr, info] of Object.entries(mapObjectSpriteMap)) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
        if (!info || info.file !== GFX_FILE_NUMBERS.RESOURCES) continue;

        const type = Number(typeStr) as MapObjectType;

        // Load 8 directions for quantities 1-8
        for (let dir = 0; dir < 8; dir++) {
            const sprite = await ctx.spriteLoader.loadJobSprite(
                ctx.fileSet,
                { jobIndex: info.index, directionIndex: dir },
                ctx.atlas,
                ctx.paletteBase
            );
            if (sprite) {
                ctx.registry.registerMapObject(type, sprite.entry, dir);
                loadedCount++;
            }
        }
    }

    return loadedCount;
}

// =============================================================================
// Resource sign sprites (geologist prospecting signs)
// =============================================================================

/**
 * Load resource sign sprites from direct GIL indices in file 5.
 * Signs show ore type and richness: empty (1 sprite), then 3 variations per ore type.
 */
async function loadResourceSignSprites(ctx: FileCtx): Promise<number> {
    const S = MAP_OBJECT_SPRITES.RESOURCE_SIGNS;

    // (MapObjectType, variation, gilIndex) triples
    const entries: Array<{ type: MapObjectType; variation: number; gilIndex: number }> = [
        { type: MapObjectType.ResEmpty, variation: 0, gilIndex: S.EMPTY },
        { type: MapObjectType.ResCoal, variation: 0, gilIndex: S.COAL.LOW },
        { type: MapObjectType.ResCoal, variation: 1, gilIndex: S.COAL.MED },
        { type: MapObjectType.ResCoal, variation: 2, gilIndex: S.COAL.RICH },
        { type: MapObjectType.ResGold, variation: 0, gilIndex: S.GOLD.LOW },
        { type: MapObjectType.ResGold, variation: 1, gilIndex: S.GOLD.MED },
        { type: MapObjectType.ResGold, variation: 2, gilIndex: S.GOLD.RICH },
        { type: MapObjectType.ResIron, variation: 0, gilIndex: S.IRON.LOW },
        { type: MapObjectType.ResIron, variation: 1, gilIndex: S.IRON.MED },
        { type: MapObjectType.ResIron, variation: 2, gilIndex: S.IRON.RICH },
        { type: MapObjectType.ResStone, variation: 0, gilIndex: S.STONE.LOW },
        { type: MapObjectType.ResStone, variation: 1, gilIndex: S.STONE.MED },
        { type: MapObjectType.ResStone, variation: 2, gilIndex: S.STONE.RICH },
        { type: MapObjectType.ResSulfur, variation: 0, gilIndex: S.SULFUR.LOW },
        { type: MapObjectType.ResSulfur, variation: 1, gilIndex: S.SULFUR.MED },
        { type: MapObjectType.ResSulfur, variation: 2, gilIndex: S.SULFUR.RICH },
    ];

    const sprites = await loadGilSpriteBatch(
        entries.map(e => e.gilIndex),
        ctx.fileSet,
        ctx.spriteLoader,
        ctx.atlas,
        ctx.gl,
        ctx.paletteBase
    );

    let loaded = 0;
    for (const { type, variation, gilIndex } of entries) {
        const entry = sprites.get(gilIndex);
        if (entry) {
            ctx.registry.registerMapObject(type, entry, variation);
            loaded++;
        }
    }

    return loaded;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all map object sprites: trees, stones, decorations, crops, flags, territory dots, resource deposits.
 * Returns true if any sprites were loaded.
 */
export async function loadMapObjectSprites(ctx: SpriteLoadContext): Promise<boolean> {
    const [fileSet5, fileSet3] = await Promise.all([
        ctx.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`),
        ctx.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.RESOURCES}`),
    ]);

    if (!fileSet5) return false;

    const fc5: FileCtx = {
        ...ctx,
        fileSet: fileSet5,
        paletteBase: getPaletteBase(ctx, `${GFX_FILE_NUMBERS.MAP_OBJECTS}`),
    };

    const treeCount = await loadTreeSprites(fc5);
    const stoneCount = await loadStoneSprites(fc5);
    const decoCount = await loadDecorationSprites(fc5);
    const cropCount = await loadCropSprites(
        ctx.spriteLoader,
        fileSet5,
        ctx.atlas,
        ctx.registry,
        ctx.gl,
        fc5.paletteBase
    );
    const flagCount = await loadFlagSprites(fc5);
    const dotCount = await loadTerritoryDotSprites(fc5);
    const signCount = await loadResourceSignSprites(fc5);

    let resourceCount = 0;
    if (fileSet3) {
        const fc3: FileCtx = {
            ...ctx,
            fileSet: fileSet3,
            paletteBase: getPaletteBase(ctx, `${GFX_FILE_NUMBERS.RESOURCES}`),
        };
        resourceCount = await loadResourceMapObjects(fc3);
    }

    const total = treeCount + stoneCount + decoCount + cropCount + flagCount + dotCount + signCount + resourceCount;
    log.debug(
        `MapObjects: ${treeCount} trees, ${stoneCount} stones, ${decoCount} decorations, ${cropCount} crops, ` +
            `${flagCount} flags, ${dotCount} territory dots, ${signCount} signs, ${resourceCount} resources (${total} total)`
    );
    return total > 0;
}

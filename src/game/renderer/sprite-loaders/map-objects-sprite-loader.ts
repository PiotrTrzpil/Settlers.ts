/**
 * Map-object sprite loading — trees, stones, decorations, flags, territory dots, resource deposits.
 * Extracted from SpriteRenderManager to keep file size under the max-lines limit.
 */

import { LogHandler } from '@/utilities/log-handler';
import { EntityTextureAtlas } from '../entity-texture-atlas';
import {
    SpriteMetadataRegistry,
    SpriteEntry,
    GFX_FILE_NUMBERS,
    getMapObjectSpriteMap,
    MAP_OBJECT_SPRITES,
    TREE_JOB_OFFSET,
    TREE_JOB_INDICES,
    TREE_JOBS_PER_TYPE,
} from '../sprite-metadata';
import { ANIMATION_DEFAULTS } from '@/game/animation';
import { SpriteLoader, type LoadedGfxFileSet } from '../sprite-loader';
import { SafeLoadBatch } from '../batch-loader';
import { EntityType } from '@/game/entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { STONE_DEPLETION_STAGES } from '@/game/features/stones/stone-system';
import { buildDecorationSpriteMap, type DecorationSpriteRef } from '../decoration-sprite-map';
import { loadCropSprites } from '../sprite-crop-loader';

const log = new LogHandler('MapObjectsSpriteLoader');

export interface MapObjectsLoadContext {
    spriteLoader: SpriteLoader;
    getPaletteBaseOffset: (fileId: string) => number;
}

// =============================================================================
// Tree sprites
// =============================================================================

/** Load all variant sprites for a single tree type. */
async function loadTreeTypeSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number,
    treeType: MapObjectType,
    variantBases: number[]
): Promise<number> {
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
            const anim = await spriteLoader.loadJobAnimation(fileSet, baseJob + offset, 0, atlas, paletteBaseOffset);
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
    batch.finalize(atlas, gl, data => {
        registry.registerMapObject(data.treeType, data.firstFrame, data.variation);
        if (data.allFrames) {
            swayFrames.set(data.variantIndex, data.allFrames);
        }
        loaded++;
    });

    // Register single animation entry — variant encoded as direction
    if (swayFrames.size > 0) {
        registry.registerAnimatedEntity(
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
async function loadTreeSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number
): Promise<number> {
    if (!fileSet.jilReader || !fileSet.dilReader) {
        log.debug('Tree JIL/DIL not available, skipping tree loading');
        return 0;
    }

    let totalLoaded = 0;

    for (const [typeStr, variantBases] of Object.entries(TREE_JOB_INDICES)) {
        if (!Array.isArray(variantBases)) continue;
        const treeType = Number(typeStr) as MapObjectType;

        totalLoaded += await loadTreeTypeSprites(
            spriteLoader,
            fileSet,
            atlas,
            registry,
            gl,
            paletteBase,
            treeType,
            variantBases
        );

        // Yield to allow rendering before next tree type
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
async function loadStoneSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number
): Promise<number> {
    type StoneStageData = { variation: number; entry: SpriteEntry };
    const batch = new SafeLoadBatch<StoneStageData>();

    const variants = [MAP_OBJECT_SPRITES.STONE_STAGES_A, MAP_OBJECT_SPRITES.STONE_STAGES_B];

    for (let v = 0; v < variants.length; v++) {
        const range = variants[v]!;
        for (let stage = 0; stage < range.count; stage++) {
            const gilIndex = range.start + stage;
            const sprite = await spriteLoader.loadDirectSprite(fileSet, gilIndex, null, atlas, paletteBase);
            if (sprite) {
                batch.add({ variation: v * STONE_DEPLETION_STAGES + stage, entry: sprite.entry });
            }
        }
    }

    let loaded = 0;
    batch.finalize(atlas, gl, data => {
        registry.registerMapObject(MapObjectType.ResourceStone, data.entry, data.variation);
        loaded++;
    });

    return loaded;
}

// =============================================================================
// Decoration sprites
// =============================================================================

/** Load a single decoration sprite entry (first frame only). */
async function loadDecoEntry(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    ref: DecorationSpriteRef,
    atlas: EntityTextureAtlas,
    paletteBase: number
): Promise<{ firstFrame: SpriteEntry; allFrames: null } | null> {
    const sprite = await spriteLoader.loadDirectSprite(fileSet, ref.gilIndex, null, atlas, paletteBase);
    return sprite ? { firstFrame: sprite.entry, allFrames: null } : null;
}

/**
 * Load decoration sprites (non-tree map objects) using direct GIL indices.
 * Deduplicates by GIL index so each unique sprite is loaded once,
 * then registered for all entity keys that share it.
 */
async function loadDecorationSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number
): Promise<number> {
    const decoMap = buildDecorationSpriteMap();

    // Deduplicate: group entity keys by gilIndex to avoid loading the same sprite multiple times
    const byGilIndex = new Map<number, { ref: DecorationSpriteRef; entityKeys: number[] }>();
    for (const [entityKey, ref] of decoMap) {
        const existing = byGilIndex.get(ref.gilIndex);
        if (existing) {
            existing.entityKeys.push(entityKey);
        } else {
            byGilIndex.set(ref.gilIndex, { ref, entityKeys: [entityKey] });
        }
    }

    type DecoData = { entityKeys: number[]; firstFrame: SpriteEntry; allFrames: SpriteEntry[] | null };
    const batch = new SafeLoadBatch<DecoData>();

    for (const { ref, entityKeys } of byGilIndex.values()) {
        const loaded = await loadDecoEntry(spriteLoader, fileSet, ref, atlas, paletteBase);
        if (loaded) batch.add({ entityKeys, ...loaded });
    }

    let totalRegistered = 0;
    batch.finalize(atlas, gl, data => {
        for (const key of data.entityKeys) {
            registry.registerMapObject(key as MapObjectType, data.firstFrame);
            totalRegistered++;
        }
    });

    return totalRegistered;
}

// =============================================================================
// Flag sprites
// =============================================================================

/**
 * Load small animated flag sprites (8 player colors × 24 frames).
 * Flags are loaded from MAP_OBJECT_SPRITES in the landscape GFX file (5.gfx).
 */
async function loadFlagSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number
): Promise<number> {
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

    type FlagData = { playerIndex: number; frame: number; entry: SpriteEntry };
    const batch = new SafeLoadBatch<FlagData>();

    for (let playerIndex = 0; playerIndex < FLAG_RANGES.length; playerIndex++) {
        const range = FLAG_RANGES[playerIndex]!;
        for (let frame = 0; frame < range.count; frame++) {
            const gilIndex = range.start + frame;
            const sprite = await spriteLoader.loadDirectSprite(fileSet, gilIndex, null, atlas, paletteBase);
            if (sprite) {
                batch.add({ playerIndex, frame, entry: sprite.entry });
            }
        }
    }

    let loaded = 0;
    batch.finalize(atlas, gl, data => {
        registry.registerFlag(data.playerIndex, data.frame, data.entry);
        loaded++;
    });

    return loaded;
}

// =============================================================================
// Territory dot sprites
// =============================================================================

/**
 * Load territory dot sprites (8 player colors) from direct GIL indices.
 */
async function loadTerritoryDotSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number
): Promise<number> {
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

    type DotData = { playerIndex: number; entry: SpriteEntry };
    const batch = new SafeLoadBatch<DotData>();

    for (let playerIndex = 0; playerIndex < DOT_GIL_INDICES.length; playerIndex++) {
        const gilIndex = DOT_GIL_INDICES[playerIndex]!;
        const sprite = await spriteLoader.loadDirectSprite(fileSet, gilIndex, null, atlas, paletteBase);
        if (sprite) {
            batch.add({ playerIndex, entry: sprite.entry });
        } else {
            console.warn(`[loadTerritoryDotSprites] GIL ${gilIndex} (player ${playerIndex}) returned null`);
        }
    }

    let loaded = 0;
    batch.finalize(atlas, gl, data => {
        registry.registerTerritoryDot(data.playerIndex, data.entry);
        loaded++;
    });

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
async function loadResourceMapObjects(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    paletteBase: number
): Promise<number> {
    const mapObjectSpriteMap = getMapObjectSpriteMap();
    let loadedCount = 0;

    for (const [typeStr, info] of Object.entries(mapObjectSpriteMap)) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
        if (!info || info.file !== GFX_FILE_NUMBERS.RESOURCES) continue;

        const type = Number(typeStr) as MapObjectType;

        // Load 8 directions for quantities 1-8
        for (let dir = 0; dir < 8; dir++) {
            const sprite = await spriteLoader.loadJobSprite(
                fileSet,
                { jobIndex: info.index, directionIndex: dir },
                atlas,
                paletteBase
            );
            if (sprite) {
                registry.registerMapObject(type, sprite.entry, dir);
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
 *
 * ResEmpty: variation 0 → GIL 1208
 * ResCoal:  variations 0/1/2 → GIL 1209/1210/1211
 * ResGold:  variations 0/1/2 → GIL 1212/1213/1214
 * ResIron:  variations 0/1/2 → GIL 1215/1216/1217
 * ResStone: variations 0/1/2 → GIL 1218/1219/1220
 * ResSulfur: variations 0/1/2 → GIL 1221/1222/1223
 */
async function loadResourceSignSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number
): Promise<number> {
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

    type SignData = { type: MapObjectType; variation: number; entry: SpriteEntry };
    const batch = new SafeLoadBatch<SignData>();

    for (const { type, variation, gilIndex } of entries) {
        const sprite = await spriteLoader.loadDirectSprite(fileSet, gilIndex, null, atlas, paletteBase);
        if (sprite) {
            batch.add({ type, variation, entry: sprite.entry });
        }
    }

    let loaded = 0;
    batch.finalize(atlas, gl, data => {
        registry.registerMapObject(data.type, data.entry, data.variation);
        loaded++;
    });

    return loaded;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all map object sprites: trees, stones, decorations, crops, flags, territory dots, resource deposits.
 * Returns true if any sprites were loaded.
 */
export async function loadMapObjectSprites(
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    ctx: MapObjectsLoadContext
): Promise<boolean> {
    const [fileSet5, fileSet3] = await Promise.all([
        ctx.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`),
        ctx.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.RESOURCES}`),
    ]);

    if (!fileSet5) return false;

    const paletteBase5 = ctx.getPaletteBaseOffset(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`);

    const treeCount = await loadTreeSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);
    const stoneCount = await loadStoneSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);
    const decoCount = await loadDecorationSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);
    const cropCount = await loadCropSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);
    const flagCount = await loadFlagSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);
    const dotCount = await loadTerritoryDotSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);
    const signCount = await loadResourceSignSprites(ctx.spriteLoader, fileSet5, atlas, registry, gl, paletteBase5);

    let resourceCount = 0;
    if (fileSet3) {
        const paletteBase3 = ctx.getPaletteBaseOffset(`${GFX_FILE_NUMBERS.RESOURCES}`);
        resourceCount = await loadResourceMapObjects(ctx.spriteLoader, fileSet3, atlas, registry, paletteBase3);
    }

    const total = treeCount + stoneCount + decoCount + cropCount + flagCount + dotCount + signCount + resourceCount;
    log.debug(
        `MapObjects: ${treeCount} trees, ${stoneCount} stones, ${decoCount} decorations, ${cropCount} crops, ` +
            `${flagCount} flags, ${dotCount} territory dots, ${signCount} signs, ${resourceCount} resources (${total} total)`
    );
    return total > 0;
}

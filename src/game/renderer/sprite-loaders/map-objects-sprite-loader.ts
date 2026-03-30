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
import { SafeLoadBatch } from '../batch-loader';
import { EntityType } from '@/game/entity';
import { MapObjectType, stoneTypeForLevel } from '@/game/types/map-object-types';
import { buildDecorationSpriteMap } from '../decoration-sprite-map';
import { loadCropSprites } from '../sprite-crop-loader';
import { loadGilSpriteBatch } from './gil-manifest-loader';
import { type SpriteLoadContext, type FileLoadContext, getPaletteBase } from '../sprite-load-context';

const log = new LogHandler('MapObjectsSpriteLoader');

// =============================================================================
// Tree sprites
// =============================================================================

/** Load all variant sprites for a single tree type. */
async function loadTreeTypeSprites(
    ctx: FileLoadContext,
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
async function loadTreeSprites(ctx: FileLoadContext): Promise<number> {
    if (!ctx.fileSet.jilReader || !ctx.fileSet.dilReader) {
        log.debug('Tree JIL/DIL not available, skipping tree loading');
        return 0;
    }

    let totalLoaded = 0;

    for (const [typeStr, variantBases] of Object.entries(TREE_JOB_INDICES)) {
        if (!Array.isArray(variantBases)) {
            continue;
        }
        const treeType = Number(typeStr) as MapObjectType;
        totalLoaded += await loadTreeTypeSprites(ctx, treeType, variantBases);
        await new Promise(r => setTimeout(r, 0));
    }

    return totalLoaded;
}

// =============================================================================
// Dark tree sprites (GIL-based, no growth stages or cut variants)
// =============================================================================

/** Dark tree type → GIL range mapping. 6 visual types × 16 sway frames, shared across 8 MapObjectType entries. */
const DARK_TREE_GIL: ReadonlyArray<{ types: MapObjectType[]; start: number; count: number }> = [
    { types: [MapObjectType.DarkTree1A], ...MAP_OBJECT_SPRITES.DARK_TREE_1 },
    { types: [MapObjectType.DarkTree1B], ...MAP_OBJECT_SPRITES.DARK_TREE_2 },
    { types: [MapObjectType.DarkTree2A], ...MAP_OBJECT_SPRITES.DARK_TREE_3 },
    { types: [MapObjectType.DarkTree2B], ...MAP_OBJECT_SPRITES.DARK_TREE_4 },
    { types: [MapObjectType.DarkTree3A, MapObjectType.DarkTree3B], ...MAP_OBJECT_SPRITES.DARK_TREE_5 },
    { types: [MapObjectType.DarkTree4A, MapObjectType.DarkTree5A], ...MAP_OBJECT_SPRITES.DARK_TREE_6 },
];

/** Collect sway frames from a GIL range. Returns null if fewer than 2 frames loaded. */
function collectSwayFrames(sprites: Map<number, SpriteEntry>, start: number, count: number): SpriteEntry[] | null {
    const frames: SpriteEntry[] = [];
    for (let i = 0; i < count; i++) {
        const entry = sprites.get(start + i);
        if (entry) {
            frames.push(entry);
        }
    }
    return frames.length > 1 ? frames : null;
}

/**
 * Load dark tree sprites from direct GIL indices.
 * Dark trees have no growth stages or cut variants — just 16 sway animation frames each.
 */
async function loadDarkTreeSprites(ctx: FileLoadContext): Promise<number> {
    const allIndices: number[] = [];
    for (const { start, count } of DARK_TREE_GIL) {
        for (let i = 0; i < count; i++) {
            allIndices.push(start + i);
        }
    }

    const sprites = await loadGilSpriteBatch(allIndices, ctx);

    let loaded = 0;
    for (const { types, start, count } of DARK_TREE_GIL) {
        const firstEntry = sprites.get(start);
        if (!firstEntry) {
            continue;
        }

        const swayFrames = collectSwayFrames(sprites, start, count);
        const frameMap = swayFrames ? new Map<number, SpriteEntry[]>([[0, swayFrames]]) : null;

        for (const type of types) {
            ctx.registry.registerMapObject(type, firstEntry);
            if (frameMap) {
                ctx.registry.registerAnimatedEntity(
                    EntityType.MapObject,
                    type,
                    frameMap,
                    ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                    true
                );
            }
            loaded++;
        }
    }

    return loaded;
}

// =============================================================================
// Stone sprites
// =============================================================================

/**
 * Load harvestable stone depletion sprites from direct GIL indices.
 * 2 variants (A, B) × 12 depletion levels = 24 sprites across ResourceStone1-12.
 * Each subType gets variation 0 (A) and variation 1 (B).
 *
 * The GIL sprite ranges have 13 stages each (indices 0-12).
 * Stage 0 is the most depleted visual; we map levels 1-12 to stage indices 1-12.
 * Stage 0 is unused (no raw byte for it — stones at level 1 are removed on next mine).
 */
async function loadStoneSprites(ctx: FileLoadContext): Promise<number> {
    const variants = [MAP_OBJECT_SPRITES.STONE_STAGES_A, MAP_OBJECT_SPRITES.STONE_STAGES_B];

    // Collect all GIL indices across both variants
    const allIndices: number[] = [];
    for (const range of variants) {
        for (let s = 0; s < range.count; s++) {
            allIndices.push(range.start + s);
        }
    }

    const sprites = await loadGilSpriteBatch(allIndices, ctx);

    let loaded = 0;
    for (let v = 0; v < variants.length; v++) {
        const range = variants[v]!;
        // Map depletion levels 1-12 to sprite stage indices 1-12
        for (let level = 1; level <= 12; level++) {
            const entry = sprites.get(range.start + level);
            if (entry) {
                ctx.registry.registerMapObject(stoneTypeForLevel(level), entry, v);
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
async function loadDecorationSprites(ctx: FileLoadContext): Promise<number> {
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

    const sprites = await loadGilSpriteBatch([...byGilIndex.keys()], ctx);

    let totalRegistered = 0;
    for (const [gilIndex, entityKeys] of byGilIndex) {
        const entry = sprites.get(gilIndex);
        if (!entry) {
            continue;
        }
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

type FlagRange = { start: number; count: number };

/** Collect GIL indices for an array of flag ranges (8 players). */
function collectFlagIndices(ranges: readonly FlagRange[]): number[] {
    const indices: number[] = [];
    for (const range of ranges) {
        for (let f = 0; f < range.count; f++) {
            indices.push(range.start + f);
        }
    }
    return indices;
}

/** Register loaded flag sprites into the registry for each player. */
function registerFlagSet(
    ranges: readonly FlagRange[],
    sprites: Map<number, SpriteEntry>,
    register: (playerIndex: number, frame: number, entry: SpriteEntry) => void
): number {
    let loaded = 0;
    for (let playerIndex = 0; playerIndex < ranges.length; playerIndex++) {
        const range = ranges[playerIndex]!;
        for (let frame = 0; frame < range.count; frame++) {
            const entry = sprites.get(range.start + frame);
            if (entry) {
                register(playerIndex, frame, entry);
                loaded++;
            }
        }
    }
    return loaded;
}

/**
 * Load small animated flag sprites (8 player colors × 12 normal + 12 lowered frames).
 * Flags are loaded from MAP_OBJECT_SPRITES in the landscape GFX file (5.gfx).
 */
async function loadFlagSprites(ctx: FileLoadContext): Promise<number> {
    const FLAG_NORMAL: FlagRange[] = [
        MAP_OBJECT_SPRITES.FLAG_SMALL_RED,
        MAP_OBJECT_SPRITES.FLAG_SMALL_BLUE,
        MAP_OBJECT_SPRITES.FLAG_SMALL_GREEN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_YELLOW,
        MAP_OBJECT_SPRITES.FLAG_SMALL_PURPLE,
        MAP_OBJECT_SPRITES.FLAG_SMALL_ORANGE,
        MAP_OBJECT_SPRITES.FLAG_SMALL_TEAL,
        MAP_OBJECT_SPRITES.FLAG_SMALL_WHITE,
    ];
    const FLAG_DOWN: FlagRange[] = [
        MAP_OBJECT_SPRITES.FLAG_SMALL_RED_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_BLUE_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_GREEN_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_YELLOW_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_PURPLE_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_ORANGE_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_TEAL_DOWN,
        MAP_OBJECT_SPRITES.FLAG_SMALL_WHITE_DOWN,
    ];

    const allIndices = [...collectFlagIndices(FLAG_NORMAL), ...collectFlagIndices(FLAG_DOWN)];
    const sprites = await loadGilSpriteBatch(allIndices, ctx);

    const normalLoaded = registerFlagSet(FLAG_NORMAL, sprites, ctx.registry.registerFlag.bind(ctx.registry));
    const downLoaded = registerFlagSet(FLAG_DOWN, sprites, ctx.registry.registerFlagDown.bind(ctx.registry));
    return normalLoaded + downLoaded;
}

// =============================================================================
// Territory dot sprites
// =============================================================================

/**
 * Load territory dot sprites (8 player colors) from direct GIL indices.
 */
async function loadTerritoryDotSprites(ctx: FileLoadContext): Promise<number> {
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

    const sprites = await loadGilSpriteBatch(DOT_GIL_INDICES, ctx);

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
async function loadResourceMapObjects(ctx: FileLoadContext): Promise<number> {
    const mapObjectSpriteMap = getMapObjectSpriteMap();
    let loadedCount = 0;

    for (const [typeStr, info] of Object.entries(mapObjectSpriteMap)) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
        if (!info || info.file !== GFX_FILE_NUMBERS.RESOURCES) {
            continue;
        }

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
async function loadResourceSignSprites(ctx: FileLoadContext): Promise<number> {
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
        ctx
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

    if (!fileSet5) {
        return false;
    }

    const fc5: FileLoadContext = {
        ...ctx,
        fileSet: fileSet5,
        paletteBase: getPaletteBase(ctx, `${GFX_FILE_NUMBERS.MAP_OBJECTS}`),
    };

    const treeCount = await loadTreeSprites(fc5);
    const darkTreeCount = await loadDarkTreeSprites(fc5);
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
        const fc3: FileLoadContext = {
            ...ctx,
            fileSet: fileSet3,
            paletteBase: getPaletteBase(ctx, `${GFX_FILE_NUMBERS.RESOURCES}`),
        };
        resourceCount = await loadResourceMapObjects(fc3);
    }

    const total =
        treeCount +
        darkTreeCount +
        stoneCount +
        decoCount +
        cropCount +
        flagCount +
        dotCount +
        signCount +
        resourceCount;
    log.debug(
        `MapObjects: ${treeCount} trees, ${darkTreeCount} dark trees, ${stoneCount} stones, ${decoCount} decorations, ` +
            `${cropCount} crops, ${flagCount} flags, ${dotCount} territory dots, ${signCount} signs, ` +
            `${resourceCount} resources (${total} total)`
    );
    return total > 0;
}

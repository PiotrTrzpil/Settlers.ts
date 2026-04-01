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
    DARK_TREE_JOB_INDICES,
    DARK_TREE_STATIC_JOB_INDICES,
    applyJilFrameSkips,
    TERRITORY_DOT_JOB,
    RESOURCE_SIGN_JOBS,
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

type AnimTarget = 'sway' | 'falling' | 'canopy' | null;

function resolveAnimTarget(offset: number, frameCount: number, animatedOffsets: ReadonlySet<number>): AnimTarget {
    if (!animatedOffsets.has(offset) || frameCount <= 1) {
        return null;
    }
    switch (offset) {
        case TREE_JOB_OFFSET.NORMAL:
            return 'sway';
        case TREE_JOB_OFFSET.FALLING:
            return 'falling';
        case TREE_JOB_OFFSET.CANOPY_DISAPPEARING:
            return 'canopy';
        default:
            return null;
    }
}

function getAnimFrameMap(
    target: NonNullable<AnimTarget>,
    sway: Map<number, SpriteEntry[]>,
    falling: Map<number, SpriteEntry[]>,
    canopy: Map<number, SpriteEntry[]>
): Map<number, SpriteEntry[]> {
    switch (target) {
        case 'sway':
            return sway;
        case 'falling':
            return falling;
        case 'canopy':
            return canopy;
    }
}

/** Load all variant sprites for a single tree type. */
async function loadTreeTypeSprites(
    ctx: FileLoadContext,
    treeType: MapObjectType,
    variantBases: number[]
): Promise<number> {
    /** Offsets that have multi-frame animations (not just static sprites) */
    const ANIMATED_OFFSETS: ReadonlySet<number> = new Set([
        TREE_JOB_OFFSET.NORMAL,
        TREE_JOB_OFFSET.FALLING,
        TREE_JOB_OFFSET.CANOPY_DISAPPEARING,
    ]);

    type TreeStageData = {
        treeType: MapObjectType;
        variation: number;
        variantIndex: number;
        firstFrame: SpriteEntry;
        allFrames: SpriteEntry[] | null;
        /** Which frame map to collect into (null = static-only) */
        animTarget: AnimTarget;
    };

    let loaded = 0;
    const swayFrames = new Map<number, SpriteEntry[]>();
    const fallingFrames = new Map<number, SpriteEntry[]>();
    const canopyFrames = new Map<number, SpriteEntry[]>();
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
            if (!anim?.frames.length) {
                continue;
            }
            const animTarget = resolveAnimTarget(offset, anim.frames.length, ANIMATED_OFFSETS);
            batch.add({
                treeType,
                variation: v * TREE_JOBS_PER_TYPE + offset,
                variantIndex: v,
                firstFrame: anim.frames[0]!.entry,
                allFrames: animTarget ? anim.frames.map(f => f.entry) : null,
                animTarget,
            });
        }
    }

    // GPU upload → register all variants for this tree type
    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerMapObject(data.treeType, data.firstFrame, data.variation);
        if (data.allFrames && data.animTarget) {
            const targetMap = getAnimFrameMap(data.animTarget, swayFrames, fallingFrames, canopyFrames);
            targetMap.set(data.variantIndex, data.allFrames);
        }
        loaded++;
    });

    // Register sway animation as the default sequence — variant encoded as direction
    if (swayFrames.size > 0) {
        ctx.registry.registerAnimatedEntity(
            EntityType.MapObject,
            treeType,
            swayFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            true
        );
    }

    // Register falling animation as an additional sequence (one-shot)
    if (fallingFrames.size > 0) {
        ctx.registry.registerAnimationSequence(
            EntityType.MapObject,
            treeType,
            'falling',
            fallingFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            false
        );
    }

    // Register canopy disappearing animation as an additional sequence (one-shot)
    if (canopyFrames.size > 0) {
        ctx.registry.registerAnimationSequence(
            EntityType.MapObject,
            treeType,
            'canopy_disappearing',
            canopyFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            false
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
// Dark tree sprites (JIL-based, no growth stages or cut variants)
// =============================================================================

/**
 * Load dark tree sprites using JIL jobs.
 * 6 animated types (16 sway frames each) + 2 static types (dark pine, dark palm).
 */
async function loadDarkTreeSprites(ctx: FileLoadContext): Promise<number> {
    if (!ctx.fileSet.jilReader || !ctx.fileSet.dilReader) {
        log.debug('Dark tree JIL/DIL not available, skipping');
        return 0;
    }

    let loaded = 0;
    const batch = new SafeLoadBatch<{
        types: MapObjectType[];
        firstFrame: SpriteEntry;
        swayFrames: SpriteEntry[] | null;
    }>();

    // Animated dark trees — each is a single JIL job with 16 sway frames
    for (const { types, job } of DARK_TREE_JOB_INDICES) {
        const anim = await ctx.spriteLoader.loadJobAnimation(ctx.fileSet, job, 0, ctx.atlas, ctx.paletteBase);
        if (!anim?.frames.length) {
            continue;
        }

        const frames = applyJilFrameSkips(
            anim.frames.map(f => f.entry),
            job
        );
        batch.add({ types, firstFrame: frames[0]!, swayFrames: frames.length > 1 ? frames : null });
    }

    // Static dark trees — single-frame JIL jobs
    for (const { types, job } of DARK_TREE_STATIC_JOB_INDICES) {
        const anim = await ctx.spriteLoader.loadJobAnimation(ctx.fileSet, job, 0, ctx.atlas, ctx.paletteBase);
        if (!anim?.frames.length) {
            continue;
        }
        batch.add({ types, firstFrame: anim.frames[0]!.entry, swayFrames: null });
    }

    batch.finalize(ctx.atlas, ctx.gl, ({ types, firstFrame, swayFrames }) => {
        const frameMap = swayFrames ? new Map<number, SpriteEntry[]>([[0, swayFrames]]) : null;
        for (const type of types) {
            ctx.registry.registerMapObject(type, firstFrame);
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
    });

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

/** Register a sprite entry for multiple entity keys. Returns the count registered. */
function registerDecoEntries(entry: SpriteEntry, entityKeys: number[], registry: FileLoadContext['registry']): number {
    for (const key of entityKeys) {
        registry.registerMapObject(key as MapObjectType, entry);
    }
    return entityKeys.length;
}

/**
 * Load decoration sprites (non-tree map objects).
 * Sprites with a jilJob are loaded via JIL; others use direct GIL indices.
 * Deduplicates so each unique sprite is loaded once, then registered for all entity keys that share it.
 */
async function loadDecorationSprites(ctx: FileLoadContext): Promise<number> {
    const decoMap = buildDecorationSpriteMap();

    // Split into GIL-based and JIL-based groups, deduplicating by key
    const byGilIndex = new Map<number, number[]>();
    const byJilJob = new Map<number, number[]>();

    for (const [entityKey, ref] of decoMap) {
        const map = ref.jilJob != null ? byJilJob : byGilIndex;
        const key = ref.jilJob != null ? ref.jilJob : ref.gilIndex;
        const existing = map.get(key);
        if (existing) {
            existing.push(entityKey);
        } else {
            map.set(key, [entityKey]);
        }
    }

    let total = 0;

    // Load GIL-based decorations
    const gilSprites = await loadGilSpriteBatch([...byGilIndex.keys()], ctx);
    for (const [gilIndex, entityKeys] of byGilIndex) {
        const entry = gilSprites.get(gilIndex);
        if (entry) {
            total += registerDecoEntries(entry, entityKeys, ctx.registry);
        }
    }

    // Load JIL-based decorations
    for (const [job, entityKeys] of byJilJob) {
        const anim = await ctx.spriteLoader.loadJobAnimation(ctx.fileSet, job, 0, ctx.atlas, ctx.paletteBase);
        if (anim?.frames.length) {
            total += registerDecoEntries(anim.frames[0]!.entry, entityKeys, ctx.registry);
        }
    }

    return total;
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
 * Flags are loaded from MAP_OBJECT_SPRITES in the map objects GFX file (5.gfx).
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
 * Load territory dot sprites (8 player colors) from JIL job 533.
 * The job has 8 frames in direction 0 — one per player color.
 */
async function loadTerritoryDotSprites(ctx: FileLoadContext): Promise<number> {
    const anim = await ctx.spriteLoader.loadJobAnimation(ctx.fileSet, TERRITORY_DOT_JOB, 0, ctx.atlas, ctx.paletteBase);
    if (!anim?.frames.length) {
        log.warn('Territory dot JIL job returned no frames');
        return 0;
    }

    let loaded = 0;
    for (let playerIndex = 0; playerIndex < anim.frames.length; playerIndex++) {
        ctx.registry.registerTerritoryDot(playerIndex, anim.frames[playerIndex]!.entry);
        loaded++;
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

        // Load directions for quantities (up to 8)
        const dirCount = Math.min(ctx.spriteLoader.getDirectionCount(ctx.fileSet, info.index), 8);
        for (let dir = 0; dir < dirCount; dir++) {
            const sprite = await ctx.spriteLoader.loadJobSprite(
                ctx.fileSet,
                { jobIndex: info.index, directionIndex: dir },
                ctx.atlas,
                ctx.paletteBase
            );
            ctx.registry.registerMapObject(type, sprite.entry, dir);
            loadedCount++;
        }
    }

    return loadedCount;
}

// =============================================================================
// Resource sign sprites (geologist prospecting signs)
// =============================================================================

/**
 * Load resource sign sprites from JIL jobs in file 5.
 * Signs show ore type and richness: empty (1 sprite), then 3 variations per ore type.
 */
async function loadResourceSignSprites(ctx: FileLoadContext): Promise<number> {
    const S = RESOURCE_SIGN_JOBS;

    // (MapObjectType, variation, jilJob) triples
    const entries: Array<{ type: MapObjectType; variation: number; job: number }> = [
        { type: MapObjectType.ResEmpty, variation: 0, job: S.EMPTY },
        { type: MapObjectType.ResCoal, variation: 0, job: S.COAL.LOW },
        { type: MapObjectType.ResCoal, variation: 1, job: S.COAL.MED },
        { type: MapObjectType.ResCoal, variation: 2, job: S.COAL.RICH },
        { type: MapObjectType.ResGold, variation: 0, job: S.GOLD.LOW },
        { type: MapObjectType.ResGold, variation: 1, job: S.GOLD.MED },
        { type: MapObjectType.ResGold, variation: 2, job: S.GOLD.RICH },
        { type: MapObjectType.ResIron, variation: 0, job: S.IRON.LOW },
        { type: MapObjectType.ResIron, variation: 1, job: S.IRON.MED },
        { type: MapObjectType.ResIron, variation: 2, job: S.IRON.RICH },
        { type: MapObjectType.ResStone, variation: 0, job: S.STONE.LOW },
        { type: MapObjectType.ResStone, variation: 1, job: S.STONE.MED },
        { type: MapObjectType.ResStone, variation: 2, job: S.STONE.RICH },
        { type: MapObjectType.ResSulfur, variation: 0, job: S.SULFUR.LOW },
        { type: MapObjectType.ResSulfur, variation: 1, job: S.SULFUR.MED },
        { type: MapObjectType.ResSulfur, variation: 2, job: S.SULFUR.RICH },
    ];

    const batch = new SafeLoadBatch<{ type: MapObjectType; variation: number; entry: SpriteEntry }>();
    for (const { type, variation, job } of entries) {
        const anim = await ctx.spriteLoader.loadJobAnimation(ctx.fileSet, job, 0, ctx.atlas, ctx.paletteBase);
        if (anim?.frames.length) {
            batch.add({ type, variation, entry: anim.frames[0]!.entry });
        }
    }

    let loaded = 0;
    batch.finalize(ctx.atlas, ctx.gl, ({ type, variation, entry }) => {
        ctx.registry.registerMapObject(type, entry, variation);
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
    ctx.registry.markMapObjectsLoaded();
    return total > 0;
}

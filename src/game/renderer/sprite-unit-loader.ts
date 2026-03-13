/**
 * Unit sprite loading: base units, carrier variants, and worker animations.
 * Extracted from SpriteRenderManager for file size and cohesion.
 *
 * All animations are registered under their XML field names from SETTLER_JOB_INDICES.
 * E.g., WC_WALK, WC_CUT_TREE, BA_WALK_FLOUR — the same keys that job-part-resolver uses.
 */

import { LogHandler } from '@/utilities/log-handler';
import { EntityTextureAtlas } from './entity-texture-atlas';
import {
    SpriteEntry,
    Race,
    getUnitSpriteMap,
    SETTLER_FILE_NUMBERS,
    CARRIER_MATERIAL_JOB_INDICES,
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    type SettlerAnimData,
    stripXmlPrefix,
    UNIT_XML_PREFIX,
} from './sprite-metadata';
import type { LoadedGfxFileSet, LoadedSprite } from './sprite-loader';
import { UnitType, EntityType } from '../entity';
import { EMaterialType } from '../economy';
import { ANIMATION_DEFAULTS, xmlKey } from '../animation/animation';
import { isMaterialAvailableForRace, isUnitAvailableForRace } from '../data/race-availability';
import { type SpriteLoadContext, getPaletteBase } from './sprite-load-context';

const log = new LogHandler('SpriteUnitLoader');

/** Convert LoadedSprite direction map to SpriteEntry direction map. */
function toEntryMap(loadedDirs: Map<number, LoadedSprite[]>): Map<number, SpriteEntry[]> {
    const result = new Map<number, SpriteEntry[]>();
    for (const [dir, sprites] of loadedDirs) {
        result.set(
            dir,
            sprites.map(s => s.entry)
        );
    }
    return result;
}

// =============================================================================
// SafeLoadBatch (shared utility)
// =============================================================================

class SafeLoadBatch<T> {
    private items: T[] = [];
    add(item: T): void {
        this.items.push(item);
    }
    finalize(atlas: EntityTextureAtlas, gl: WebGL2RenderingContext, register: (item: T) => void): void {
        if (this.items.length === 0) {
            return;
        }
        atlas.update(gl);
        for (const item of this.items) {
            register(item);
        }
        this.items = [];
    }
    get count(): number {
        return this.items.length;
    }
}

// =============================================================================
// Context types
// =============================================================================

/** Pre-resolved context for internal functions operating on a single settler file. */
interface UnitFileCtx extends SpriteLoadContext {
    fileSet: LoadedGfxFileSet;
    paletteBase: number;
    race: Race;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all unit sprites for a race: base units, carrier material variants, and all
 * worker animations (registered under XML field names from SETTLER_JOB_INDICES).
 * Returns true if any unit sprites were loaded.
 */
export async function loadUnitSpritesForRace(race: Race, ctx: SpriteLoadContext): Promise<boolean> {
    const fileId = `${SETTLER_FILE_NUMBERS[race]}`;
    const fileSet = await ctx.spriteLoader.loadFileSet(fileId);
    if (!fileSet?.jilReader || !fileSet.dilReader) {
        return false;
    }

    const fc: UnitFileCtx = { ...ctx, fileSet, paletteBase: getPaletteBase(ctx, fileId), race };

    const unitCount = await loadBaseUnits(fc);
    const carrierCount = await loadCarrierVariants(fc);
    const animCount = await loadAllWorkerAnimations(fc);

    if (unitCount > 0 || carrierCount > 0 || animCount > 0) {
        log.debug(`${Race[race]}: ${unitCount} units, ${carrierCount} carriers, ${animCount} animation sequences`);
    }

    return unitCount > 0;
}

// =============================================================================
// Internals
// =============================================================================

async function loadBaseUnits(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    type UnitData = { unitType: UnitType; directionFrames: Map<number, SpriteEntry[]>; walkKey: string };
    const batch = new SafeLoadBatch<UnitData>();

    const unitEntries = Object.entries(getUnitSpriteMap(race)).filter(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
        (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] != null
    );

    // Batch-load all unit types in a single worker round-trip
    const jobIndices = unitEntries.map(([, info]) => info.index);
    const allDirs = await ctx.spriteLoader.loadMultiJobBatch(fileSet, jobIndices, ctx.atlas, paletteBase);

    for (const [typeStr, info] of unitEntries) {
        const unitType = typeStr as UnitType;
        const loadedDirs = allDirs.get(info.index);
        if (!loadedDirs) {
            continue;
        }
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) {
            const prefix = UNIT_XML_PREFIX[unitType];
            if (!prefix) {
                continue;
            }
            const walkKey = xmlKey(prefix, 'WALK');
            batch.add({ unitType, directionFrames, walkKey });
        }
    }

    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerAnimatedEntity(
            EntityType.Unit,
            data.unitType,
            data.directionFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            true,
            race,
            data.walkKey
        );
        for (const [dir, frames] of data.directionFrames) {
            if (frames.length > 0) {
                ctx.registry.registerUnit(data.unitType, dir, frames[0]!, race);
            }
        }
    });

    return batch.count;
}

async function loadCarrierVariants(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;

    const carrierJobs = Object.entries(CARRIER_MATERIAL_JOB_INDICES)
        .filter(([typeStr]) => isMaterialAvailableForRace(typeStr as EMaterialType, ctx.race))
        .map(([typeStr, jobIndex]) => ({ jobIndex, materialType: typeStr as EMaterialType }));

    const batch = new SafeLoadBatch<{ seqKey: string; frames: Map<number, SpriteEntry[]> }>();

    const jobIndices = carrierJobs.map(j => j.jobIndex);
    const allDirs = await ctx.spriteLoader.loadMultiJobBatch(fileSet, jobIndices, ctx.atlas, paletteBase);

    for (const job of carrierJobs) {
        const loadedDirs = allDirs.get(job.jobIndex);
        if (!loadedDirs) {
            continue;
        }
        const dirFrames = toEntryMap(loadedDirs);
        if (dirFrames.size === 0) {
            continue;
        }
        // Register carrier material walk under the XML name: C_WALK_{MATERIAL}
        // (these aren't in SETTLER_JOB_INDICES because there are too many —
        // CARRIER_MATERIAL_JOB_INDICES is generated from RESOURCE_JOB_INDICES)
        // job.materialType is a string enum value (e.g. 'LOG'), use directly as the name
        const seqKey = xmlKey('C', `WALK_${job.materialType}`);
        batch.add({ seqKey, frames: dirFrames });
    }

    let count = 0;
    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerAnimationSequence(
            EntityType.Unit,
            UnitType.Carrier,
            data.seqKey,
            data.frames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            true,
            race
        );
        count++;
    });

    return count;
}

// =============================================================================
// Worker animations — register all SETTLER_JOB_INDICES fields under XML names
// =============================================================================

type AnimJob = { unitType: UnitType; xmlFieldName: string; jobIndex: number };

/**
 * Collect all non-walk animation jobs from SETTLER_JOB_INDICES.
 * Walk jobs are already loaded by loadBaseUnits; everything else (work, carry,
 * pickup, fight, idle) is collected here and registered under the XML field name.
 */
function collectAllAnimJobs(ctx: UnitFileCtx): AnimJob[] {
    const { fileSet, race } = ctx;
    const jobs: AnimJob[] = [];

    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) {
            continue;
        }
        if (!isUnitAvailableForRace(unitType, race)) {
            continue;
        }

        for (const [fieldName, jobIndex] of Object.entries(workerData as SettlerAnimData)) {
            // Skip the base WALK field — already loaded by loadBaseUnits
            if (stripXmlPrefix(fieldName) === 'WALK') {
                continue;
            }

            const dirCount = ctx.spriteLoader.getDirectionCount(fileSet, jobIndex);
            if (dirCount > 0) {
                jobs.push({ unitType, xmlFieldName: fieldName, jobIndex });
            }
        }
    }

    return jobs;
}

/**
 * Load all non-walk animations from SETTLER_JOB_INDICES and register each
 * under its XML field name as the sequence key.
 */
async function loadAllWorkerAnimations(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    const animJobs = collectAllAnimJobs(ctx);
    if (animJobs.length === 0) {
        return 0;
    }

    type SeqData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<SeqData>();

    // Batch-load all jobs in a single worker round-trip
    const jobIndices = animJobs.map(j => j.jobIndex);
    const allDirs = await ctx.spriteLoader.loadMultiJobBatch(fileSet, jobIndices, ctx.atlas, paletteBase);

    for (const job of animJobs) {
        const loadedDirs = allDirs.get(job.jobIndex);
        if (!loadedDirs) {
            continue;
        }
        const dirFrames = toEntryMap(loadedDirs);
        if (dirFrames.size === 0) {
            continue;
        }
        batch.add({ unitType: job.unitType, seqKey: job.xmlFieldName, frames: dirFrames });
    }

    let count = 0;
    batch.finalize(ctx.atlas, ctx.gl, data => {
        // Determine loop behaviour from the action suffix
        const action = stripXmlPrefix(data.seqKey);
        const loop = !action.startsWith('PICKUP') && !action.startsWith('DOWN') && !action.startsWith('DROP');

        ctx.registry.registerAnimationSequence(
            EntityType.Unit,
            data.unitType,
            data.seqKey,
            data.frames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            loop,
            race
        );
        count++;
    });

    return count;
}

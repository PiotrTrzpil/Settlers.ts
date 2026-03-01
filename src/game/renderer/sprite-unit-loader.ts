/**
 * Unit sprite loading: base units, carrier variants, and worker animations.
 * Extracted from SpriteRenderManager for file size and cohesion.
 */

import { LogHandler } from '@/utilities/log-handler';
import { EntityTextureAtlas } from './entity-texture-atlas';
import {
    SpriteMetadataRegistry,
    SpriteEntry,
    Race,
    getUnitSpriteMap,
    SETTLER_FILE_NUMBERS,
    CARRIER_MATERIAL_JOB_INDICES,
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    type SettlerAnimData,
    collectFieldsByPrefix,
    collectFieldsWithSuffix,
    parseMaterialSuffix,
    getFirstFieldByPrefix,
} from './sprite-metadata';
import type { LoadedGfxFileSet, LoadedSprite } from './sprite-loader';
import { UnitType, EntityType } from '../entity';
import { EMaterialType } from '../economy';
import {
    ANIMATION_DEFAULTS,
    carrySequenceKey,
    fightSequenceKey,
    levelIdleSequenceKey,
    levelWalkSequenceKey,
    pickupSequenceKey,
    workSequenceKey,
} from '../animation';
import { isMaterialAvailableForRace, isUnitAvailableForRace } from '../race-availability';
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
// SafeLoadBatch (shared utility, duplicated to avoid circular deps)
// =============================================================================

class SafeLoadBatch<T> {
    private items: T[] = [];
    add(item: T): void {
        this.items.push(item);
    }
    finalize(atlas: EntityTextureAtlas, gl: WebGL2RenderingContext, register: (item: T) => void): void {
        if (this.items.length === 0) return;
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
// Generic sequence animation loader
// =============================================================================

type SeqAnimEntry = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };

/**
 * Generic loader for animation sequences. Most sequence loaders follow the same
 * structure: parallel-load directions → batch → registerAnimationSequence.
 *
 * @param jobs - Pre-collected job descriptors, each with a `jobIndex` for sprite loading
 * @param mapResult - Converts loaded direction frames into one or more sequence entries
 * @param onLoadError - Optional error handler for load failures (default: skip silently)
 */
async function loadSequenceAnimations<J extends { jobIndex: number }>(
    ctx: UnitFileCtx,
    jobs: J[],
    mapResult: (job: J, dirFrames: Map<number, SpriteEntry[]>) => SeqAnimEntry[],
    onLoadError?: (job: J, error: unknown) => void
): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    const batch = new SafeLoadBatch<SeqAnimEntry>();

    const results = await Promise.all(
        jobs.map(async job => {
            try {
                const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(
                    fileSet,
                    job.jobIndex,
                    ctx.atlas,
                    paletteBase
                );
                return { job, loadedDirs };
            } catch (e) {
                onLoadError?.(job, e);
                return { job, loadedDirs: null };
            }
        })
    );

    for (const { job, loadedDirs } of results) {
        if (!loadedDirs) continue;
        const dirFrames = toEntryMap(loadedDirs);
        if (dirFrames.size === 0) continue;
        for (const entry of mapResult(job, dirFrames)) {
            batch.add(entry);
        }
    }

    let count = 0;
    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerAnimationSequence(
            EntityType.Unit,
            data.unitType,
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
// Job collectors (shared by sequence loaders)
// =============================================================================

type PrefixJob = { unitType: UnitType; fieldIndex: number; jobIndex: number };

/** Collect jobs from SETTLER_JOB_INDICES for fields matching a prefix (e.g., 'work'). */
function collectPrefixJobs(ctx: UnitFileCtx, prefix: string): PrefixJob[] {
    const { fileSet } = ctx;
    const jobs: PrefixJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        const indices = collectFieldsByPrefix(workerData as SettlerAnimData, prefix);
        for (let i = 0; i < indices.length; i++) {
            const jobIndex = indices[i]!;
            if (ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
                jobs.push({ unitType, fieldIndex: i, jobIndex });
            }
        }
    }
    return jobs;
}

type SuffixJob = { unitType: UnitType; suffix: string; jobIndex: number };

/** Collect jobs from SETTLER_JOB_INDICES for fields with suffix variants (e.g., 'pickup', 'carry'). */
function collectSuffixJobs(ctx: UnitFileCtx, prefix: string, skipTypes?: ReadonlySet<UnitType>): SuffixJob[] {
    const { fileSet } = ctx;
    const jobs: SuffixJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined || skipTypes?.has(unitType)) continue;
        for (const { suffix, jobIndex } of collectFieldsWithSuffix(workerData as SettlerAnimData, prefix)) {
            if (ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
                jobs.push({ unitType, suffix, jobIndex });
            }
        }
    }
    return jobs;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all unit sprites for a race: base units, carrier material variants, and worker animations.
 * Returns true if any unit sprites were loaded.
 */
export async function loadUnitSpritesForRace(race: Race, ctx: SpriteLoadContext): Promise<boolean> {
    const fileId = `${SETTLER_FILE_NUMBERS[race]}`;
    const fileSet = await ctx.spriteLoader.loadFileSet(fileId);
    if (!fileSet?.jilReader || !fileSet.dilReader) return false;

    const fc: UnitFileCtx = { ...ctx, fileSet, paletteBase: getPaletteBase(ctx, fileId), race };

    const unitCount = await loadBaseUnits(fc);
    const carrierCount = await loadCarrierVariants(fc);
    const workerCount = await loadWorkerAnimations(fc);
    const workerCarryCount = await loadWorkerCarryAnimations(fc);
    const pickupCount = await loadPickupAnimations(fc);
    const fightCount = await loadFightAnimations(fc);
    const levelCount = await loadMilitaryLevelAnimations(fc);

    if (unitCount > 0 || carrierCount > 0 || workerCount > 0 || fightCount > 0 || levelCount > 0) {
        log.debug(
            `${Race[race]}: ${unitCount} units, ${carrierCount} carriers, ` +
                `${workerCount} workers (${workerCarryCount} carry, ${pickupCount} pickup), ` +
                `${fightCount} fight anims, ${levelCount} level anims`
        );
    }

    return unitCount > 0;
}

// =============================================================================
// Internals
// =============================================================================

async function loadBaseUnits(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    type UnitData = { unitType: UnitType; directionFrames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<UnitData>();

    const unitEntries = Object.entries(getUnitSpriteMap(race)).filter(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
        (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] != null
    );

    // Load all unit types in parallel — each one internally parallelizes directions
    const unitResults = await Promise.all(
        unitEntries.map(async([typeStr, info]) => {
            const unitType = Number(typeStr) as UnitType;
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, info.index, ctx.atlas, paletteBase);
            return { unitType, loadedDirs };
        })
    );

    for (const { unitType, loadedDirs } of unitResults) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) batch.add({ unitType, directionFrames });
    }

    batch.finalize(ctx.atlas, ctx.gl, data => {
        ctx.registry.registerAnimatedEntity(
            EntityType.Unit,
            data.unitType,
            data.directionFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            true,
            race
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
    const carrierJobs = Object.entries(CARRIER_MATERIAL_JOB_INDICES)
        .filter(([typeStr]) => isMaterialAvailableForRace(Number(typeStr) as EMaterialType, ctx.race))
        .map(([typeStr, jobIndex]) => ({ jobIndex, materialType: Number(typeStr) as EMaterialType }));

    return loadSequenceAnimations(ctx, carrierJobs, (job, frames) => [
        { unitType: UnitType.Carrier, seqKey: carrySequenceKey(job.materialType), frames },
    ]);
}

/**
 * Extract military level (1-3) from a SETTLER_JOB_INDICES key like 'swordsman_2'.
 * Returns 0 for non-military/non-levelled keys.
 */
function getMilitaryLevel(workerKey: string): number {
    const match = /_(\d+)$/.exec(workerKey);
    return match ? parseInt(match[1]!, 10) : 0;
}

async function loadWorkerAnimations(ctx: UnitFileCtx): Promise<number> {
    return loadSequenceAnimations(ctx, collectPrefixJobs(ctx, 'work'), (job, frames) => [
        { unitType: job.unitType, seqKey: workSequenceKey(job.fieldIndex), frames },
    ]);
}

async function loadPickupAnimations(ctx: UnitFileCtx): Promise<number> {
    return loadSequenceAnimations(ctx, collectSuffixJobs(ctx, 'pickup'), (job, frames) => [
        { unitType: job.unitType, seqKey: pickupSequenceKey(job.suffix), frames },
    ]);
}

type CarryAnimData = {
    unitType: UnitType;
    suffix: string;
    directionFrames: Map<number, SpriteEntry[]>;
};

/** Register carry sequences for one unit type; returns count of registered sequences. */
function registerCarryVariants(
    unitType: UnitType,
    variants: CarryAnimData[],
    allMaterialTypes: number[],
    race: Race,
    registry: SpriteMetadataRegistry
): number {
    const coveredMaterials = new Set<number>();
    let count = 0;

    for (const { suffix, directionFrames } of variants) {
        const material = parseMaterialSuffix(suffix);
        if (material !== null) {
            registry.registerAnimationSequence(
                EntityType.Unit,
                unitType,
                carrySequenceKey(material),
                directionFrames,
                ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                true,
                race
            );
            coveredMaterials.add(material);
            count++;
        }
    }

    const fallback = variants[0]!;
    for (const matId of allMaterialTypes) {
        if (!coveredMaterials.has(matId)) {
            registry.registerAnimationSequence(
                EntityType.Unit,
                unitType,
                carrySequenceKey(matId),
                fallback.directionFrames,
                ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                true,
                race
            );
            count++;
        }
    }

    return count;
}

/**
 * Load carry animations for workers that transport materials back to their building.
 *
 * Workers with material-specific carry sprites (e.g., miner: carry_coal, carry_iron)
 * get each variant registered for its matching EMaterialType(s) via JIL_SUFFIX_TO_MATERIALS.
 * A generic/numbered carry variant is registered as fallback for all remaining materials.
 *
 * Skips Carrier since it already has per-material carrier variants
 * registered by loadCarrierVariants.
 */
async function loadWorkerCarryAnimations(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    const batch = new SafeLoadBatch<CarryAnimData>();

    const carryJobs = collectSuffixJobs(ctx, 'carry', new Set([UnitType.Carrier]));

    const results = await Promise.all(
        carryJobs.map(async({ unitType, suffix, jobIndex }) => {
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, ctx.atlas, paletteBase);
            return { unitType, suffix, loadedDirs };
        })
    );

    for (const { unitType, suffix, loadedDirs } of results) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) batch.add({ unitType, suffix, directionFrames });
    }

    // All material types that can appear as carry_X sequence keys
    const allMaterialTypes = Object.keys(CARRIER_MATERIAL_JOB_INDICES)
        .map(Number)
        .filter(matId => isMaterialAvailableForRace(matId as EMaterialType, race));

    let loadedCount = 0;
    // Group by unitType so we can track which materials are covered per worker
    const byUnit = new Map<UnitType, CarryAnimData[]>();
    batch.finalize(ctx.atlas, ctx.gl, data => {
        let list = byUnit.get(data.unitType);
        if (!list) {
            list = [];
            byUnit.set(data.unitType, list);
        }
        list.push(data);
    });

    for (const [unitType, variants] of byUnit) {
        loadedCount += registerCarryVariants(unitType, variants, allMaterialTypes, race, ctx.registry);
    }

    return loadedCount;
}

type FightJob = { unitType: UnitType; fightIndex: number; jobIndex: number };

/** Fight animations that only exist in a specific race's JIL file. */
const RACE_SPECIFIC_FIGHT_ANIMS: ReadonlyMap<string, Race> = new Map([
    ['donkey', Race.Trojan], // donkey fight animation only in file 24 (Trojan)
]);

/** Returns true if this unit's fight animation is known to only exist in another race's file. */
function isFightAnimRaceSpecific(workerKey: string, race: Race): boolean {
    const exclusiveRace = RACE_SPECIFIC_FIGHT_ANIMS.get(workerKey);
    return exclusiveRace !== undefined && exclusiveRace !== race;
}

/** Collect fight animation jobs from SETTLER_JOB_INDICES, using military level for fight index offset. */
function collectFightJobs(ctx: UnitFileCtx): FightJob[] {
    const { fileSet, race } = ctx;
    const fileId = SETTLER_FILE_NUMBERS[race];
    const jobs: FightJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        if (!isUnitAvailableForRace(unitType, race)) continue;

        const fightJobIndices = collectFieldsByPrefix(workerData as SettlerAnimData, 'fight');
        if (fightJobIndices.length === 0) continue;

        const level = getMilitaryLevel(workerKey);
        const baseFightIndex = level > 0 ? level - 1 : 0;

        for (let i = 0; i < fightJobIndices.length; i++) {
            const jobIndex = fightJobIndices[i]!;
            const dirCount = ctx.spriteLoader.getDirectionCount(fileSet, jobIndex);
            if (dirCount > 0) {
                jobs.push({ unitType, fightIndex: baseFightIndex + i, jobIndex });
            } else if (!isFightAnimRaceSpecific(workerKey, race)) {
                log.error(
                    `Fight animation missing: ${workerKey} JIL index ${jobIndex} has 0 directions ` +
                        `in file ${fileId}.jil (${Race[race]}) — fix the index in jil-indices.ts`
                );
            }
        }
    }
    return jobs;
}

async function loadFightAnimations(ctx: UnitFileCtx): Promise<number> {
    return loadSequenceAnimations(
        ctx,
        collectFightJobs(ctx),
        (job, frames) => [{ unitType: job.unitType, seqKey: fightSequenceKey(job.fightIndex), frames }],
        (job, e) => {
            const fileId = SETTLER_FILE_NUMBERS[ctx.race];
            log.error(
                `Fight animation load crashed: JIL index ${job.jobIndex} for ${UnitType[job.unitType]} ` +
                    `(fight.${job.fightIndex}) in file ${fileId}.jil (${Race[ctx.race]}) — ` +
                    `index likely points to invalid data. ` +
                    `Fix the index in jil-indices.ts. Error: ${e}`
            );
        }
    );
}

/** Extract frame[0] per direction (idle pose). */
function extractIdleFrames(directionFrames: Map<number, SpriteEntry[]>): Map<number, SpriteEntry[]> {
    const result = new Map<number, SpriteEntry[]>();
    for (const [dir, frames] of directionFrames) {
        if (frames.length > 0) result.set(dir, [frames[0]!]);
    }
    return result;
}

/** Extract frames[1+] per direction (walk cycle, skipping idle frame). */
function extractWalkFrames(directionFrames: Map<number, SpriteEntry[]>): Map<number, SpriteEntry[]> {
    const result = new Map<number, SpriteEntry[]>();
    for (const [dir, frames] of directionFrames) {
        if (frames.length > 1) result.set(dir, frames.slice(1));
        else if (frames.length === 1) result.set(dir, frames);
    }
    return result;
}

/** Collect military level > 1 idle jobs from SETTLER_JOB_INDICES. */
function collectMilitaryLevelJobs(ctx: UnitFileCtx): { unitType: UnitType; level: number; jobIndex: number }[] {
    const { fileSet } = ctx;
    const jobs: { unitType: UnitType; level: number; jobIndex: number }[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const level = getMilitaryLevel(workerKey);
        if (level <= 1) continue;
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        const jobIndex = getFirstFieldByPrefix(workerData as SettlerAnimData, 'idle');
        if (jobIndex === undefined) continue;
        if (jobIndex >= 0 && ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
            jobs.push({ unitType, level, jobIndex });
        }
    }
    return jobs;
}

/**
 * Load level 2/3 idle and walk animations for military units.
 * Level 1 idle/walk is already loaded by loadBaseUnits from UNIT_BASE_JOB_INDICES.
 * This registers level-specific sequences (e.g., 'default.2', 'walk.2') on the same entity.
 */
async function loadMilitaryLevelAnimations(ctx: UnitFileCtx): Promise<number> {
    return loadSequenceAnimations(ctx, collectMilitaryLevelJobs(ctx), (_job, dirFrames) => {
        const entries: SeqAnimEntry[] = [];
        const idleFrames = extractIdleFrames(dirFrames);
        if (idleFrames.size > 0) {
            entries.push({ unitType: _job.unitType, seqKey: levelIdleSequenceKey(_job.level), frames: idleFrames });
        }
        const walkFrames = extractWalkFrames(dirFrames);
        if (walkFrames.size > 0) {
            entries.push({ unitType: _job.unitType, seqKey: levelWalkSequenceKey(_job.level), frames: walkFrames });
        }
        return entries;
    });
}

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
    const { fileSet, race, paletteBase } = ctx;
    type CarrierData = { materialType: EMaterialType; directionFrames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<CarrierData>();

    const carrierEntries = Object.entries(CARRIER_MATERIAL_JOB_INDICES).filter(([typeStr]) =>
        isMaterialAvailableForRace(Number(typeStr) as EMaterialType, race)
    );

    const carrierResults = await Promise.all(
        carrierEntries.map(async([typeStr, jobIndex]) => {
            const materialType = Number(typeStr) as EMaterialType;
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, ctx.atlas, paletteBase);
            return { materialType, loadedDirs };
        })
    );

    for (const { materialType, loadedDirs } of carrierResults) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) batch.add({ materialType, directionFrames });
    }

    batch.finalize(ctx.atlas, ctx.gl, data => {
        const carryingUnitTypes = [UnitType.Carrier, UnitType.Woodcutter];
        for (const unitType of carryingUnitTypes) {
            ctx.registry.registerAnimationSequence(
                EntityType.Unit,
                unitType,
                carrySequenceKey(data.materialType),
                data.directionFrames,
                ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                true,
                race
            );
        }
    });

    return batch.count;
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
    const { fileSet, race, paletteBase } = ctx;
    type WorkAnimData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<WorkAnimData>();

    // Collect all work animation jobs to load in parallel
    type WorkJob = { unitType: UnitType; workIndex: number; jobIndex: number };
    const workJobs: WorkJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        const workJobIndices = collectFieldsByPrefix(workerData as SettlerAnimData, 'work');
        for (let workIndex = 0; workIndex < workJobIndices.length; workIndex++) {
            const jobIndex = workJobIndices[workIndex]!;
            if (ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
                workJobs.push({ unitType, workIndex, jobIndex });
            }
        }
    }

    const workerResults = await Promise.all(
        workJobs.map(async({ unitType, workIndex, jobIndex }) => {
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, ctx.atlas, paletteBase);
            return { unitType, workIndex, loadedDirs };
        })
    );

    for (const { unitType, workIndex, loadedDirs } of workerResults) {
        if (!loadedDirs) continue;
        const frames = toEntryMap(loadedDirs);
        if (frames.size > 0) batch.add({ unitType, seqKey: workSequenceKey(workIndex), frames });
    }

    let loadedCount = 0;
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
        loadedCount++;
    });

    return loadedCount;
}

/**
 * Load pickup animations from 'pickup' JIL fields.
 * These are one-shot animations (bending down to pick up / put down material).
 *
 * Keyed by material suffix from JIL field names:
 *   pickup       → 'pickup.0'     (generic)
 *   pickup_coal  → 'pickup.coal'  (material-specific)
 *   pickup_iron  → 'pickup.iron'
 *
 * The job-part-resolver maps jobPart strings (e.g., M_PICKUP_COAL → 'pickup.coal')
 * to look up the correct animation at runtime.
 */
async function loadPickupAnimations(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    type PickupAnimData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<PickupAnimData>();

    type PickupJob = { unitType: UnitType; variant: string; jobIndex: number };
    const pickupJobs: PickupJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        for (const { suffix, jobIndex } of collectFieldsWithSuffix(workerData as SettlerAnimData, 'pickup')) {
            if (ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
                pickupJobs.push({ unitType, variant: suffix, jobIndex });
            }
        }
    }

    const pickupResults = await Promise.all(
        pickupJobs.map(async({ unitType, variant, jobIndex }) => {
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, ctx.atlas, paletteBase);
            return { unitType, variant, loadedDirs };
        })
    );

    for (const { unitType, variant, loadedDirs } of pickupResults) {
        if (!loadedDirs) continue;
        const frames = toEntryMap(loadedDirs);
        if (frames.size > 0) batch.add({ unitType, seqKey: pickupSequenceKey(variant), frames });
    }

    let loadedCount = 0;
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
        loadedCount++;
    });

    return loadedCount;
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
 * Skips Carrier and Woodcutter since they already have per-material carrier variants
 * registered by loadCarrierVariants.
 */
async function loadWorkerCarryAnimations(ctx: UnitFileCtx): Promise<number> {
    const { fileSet, race, paletteBase } = ctx;
    const batch = new SafeLoadBatch<CarryAnimData>();

    // These unit types already have per-material carry variants from loadCarrierVariants
    const skipUnitTypes = new Set([UnitType.Carrier, UnitType.Woodcutter]);

    type CarryJob = { unitType: UnitType; suffix: string; jobIndex: number };
    const carryJobs: CarryJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined || skipUnitTypes.has(unitType)) continue;

        for (const { suffix, jobIndex } of collectFieldsWithSuffix(workerData as SettlerAnimData, 'carry')) {
            if (ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
                carryJobs.push({ unitType, suffix, jobIndex });
            }
        }
    }

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
            } else {
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
    const { fileSet, race, paletteBase } = ctx;
    type FightAnimData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<FightAnimData>();

    const fightJobs = collectFightJobs(ctx);

    const fightResults = await Promise.all(
        fightJobs.map(async({ unitType, fightIndex, jobIndex }) => {
            try {
                const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(
                    fileSet,
                    jobIndex,
                    ctx.atlas,
                    paletteBase
                );
                return { unitType, fightIndex, loadedDirs };
            } catch (e) {
                const fileId = SETTLER_FILE_NUMBERS[race];
                log.error(
                    `Fight animation load crashed: JIL index ${jobIndex} for ${UnitType[unitType]} ` +
                        `(fight.${fightIndex}) in file ${fileId}.jil (${Race[race]}) — ` +
                        `index likely points to invalid data. ` +
                        `Fix the index in jil-indices.ts. Error: ${e}`
                );
                return { unitType, fightIndex, loadedDirs: null };
            }
        })
    );

    for (const { unitType, fightIndex, loadedDirs } of fightResults) {
        if (!loadedDirs) continue;
        const frames = toEntryMap(loadedDirs);
        if (frames.size > 0) batch.add({ unitType, seqKey: fightSequenceKey(fightIndex), frames });
    }

    let fightLoadedCount = 0;
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
        fightLoadedCount++;
    });

    return fightLoadedCount;
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
    const { fileSet, race, paletteBase } = ctx;
    type LevelAnimData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<LevelAnimData>();

    const idleJobs = collectMilitaryLevelJobs(ctx);

    const results = await Promise.all(
        idleJobs.map(async({ unitType, level, jobIndex }) => {
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, ctx.atlas, paletteBase);
            return { unitType, level, loadedDirs };
        })
    );

    for (const { unitType, level, loadedDirs } of results) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size === 0) continue;

        const idleFrames = extractIdleFrames(directionFrames);
        if (idleFrames.size > 0) {
            batch.add({ unitType, seqKey: levelIdleSequenceKey(level), frames: idleFrames });
        }
        const walkFrames = extractWalkFrames(directionFrames);
        if (walkFrames.size > 0) {
            batch.add({ unitType, seqKey: levelWalkSequenceKey(level), frames: walkFrames });
        }
    }

    let levelLoadedCount = 0;
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
        levelLoadedCount++;
    });

    return levelLoadedCount;
}

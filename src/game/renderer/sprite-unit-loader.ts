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
    getFirstFieldByPrefix,
} from './sprite-metadata';
import { SpriteLoader, type LoadedGfxFileSet, type LoadedSprite } from './sprite-loader';
import { UnitType, EntityType } from '../entity';
import { EMaterialType } from '../economy';
import {
    ANIMATION_DEFAULTS,
    carrySequenceKey,
    fightSequenceKey,
    levelIdleSequenceKey,
    levelWalkSequenceKey,
    workSequenceKey,
} from '../animation';
import { isMaterialAvailableForRace, isUnitAvailableForRace } from '../race-availability';

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
// Context passed from SpriteRenderManager
// =============================================================================

export interface UnitLoadContext {
    spriteLoader: SpriteLoader;
    getPaletteBaseOffset: (fileId: string) => number;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all unit sprites for a race: base units, carrier material variants, and worker animations.
 * Returns true if any unit sprites were loaded.
 */
export async function loadUnitSpritesForRace(
    race: Race,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    ctx: UnitLoadContext
): Promise<boolean> {
    const fileId = `${SETTLER_FILE_NUMBERS[race]}`;
    const fileSet = await ctx.spriteLoader.loadFileSet(fileId);
    if (!fileSet?.jilReader || !fileSet.dilReader) return false;

    const paletteBase = ctx.getPaletteBaseOffset(fileId);

    const unitCount = await loadBaseUnits(fileSet, race, atlas, registry, gl, paletteBase, ctx);
    const carrierCount = await loadCarrierVariants(fileSet, atlas, registry, gl, paletteBase, race, ctx);
    const workerCount = await loadWorkerAnimations(fileSet, atlas, registry, gl, paletteBase, race, ctx);
    const workerCarryCount = await loadWorkerCarryAnimations(fileSet, atlas, registry, gl, paletteBase, race, ctx);
    const fightCount = await loadFightAnimations(fileSet, atlas, registry, gl, paletteBase, race, ctx);
    const levelCount = await loadMilitaryLevelAnimations(fileSet, atlas, registry, gl, paletteBase, race, ctx);

    if (unitCount > 0 || carrierCount > 0 || workerCount > 0 || fightCount > 0 || levelCount > 0) {
        log.debug(
            `${Race[race]}: ${unitCount} units, ${carrierCount} carriers, ` +
                `${workerCount} workers (${workerCarryCount} carry), ${fightCount} fight anims, ${levelCount} level anims`
        );
    }

    return unitCount > 0;
}

// =============================================================================
// Internals
// =============================================================================

async function loadBaseUnits(
    fileSet: LoadedGfxFileSet,
    race: Race,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBase: number,
    ctx: UnitLoadContext
): Promise<number> {
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
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, info.index, atlas, paletteBase);
            return { unitType, loadedDirs };
        })
    );

    for (const { unitType, loadedDirs } of unitResults) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) batch.add({ unitType, directionFrames });
    }

    batch.finalize(atlas, gl, data => {
        registry.registerAnimatedEntity(
            EntityType.Unit,
            data.unitType,
            data.directionFrames,
            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
            true,
            race
        );
        for (const [dir, frames] of data.directionFrames) {
            if (frames.length > 0) {
                registry.registerUnit(data.unitType, dir, frames[0]!, race);
            }
        }
    });

    return batch.count;
}

async function loadCarrierVariants(
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number,
    race: Race,
    ctx: UnitLoadContext
): Promise<number> {
    type CarrierData = { materialType: EMaterialType; directionFrames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<CarrierData>();

    const carrierEntries = Object.entries(CARRIER_MATERIAL_JOB_INDICES).filter(([typeStr]) =>
        isMaterialAvailableForRace(Number(typeStr) as EMaterialType, race)
    );

    const carrierResults = await Promise.all(
        carrierEntries.map(async([typeStr, jobIndex]) => {
            const materialType = Number(typeStr) as EMaterialType;
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas, paletteBaseOffset);
            return { materialType, loadedDirs };
        })
    );

    for (const { materialType, loadedDirs } of carrierResults) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) batch.add({ materialType, directionFrames });
    }

    batch.finalize(atlas, gl, data => {
        const carryingUnitTypes = [UnitType.Carrier, UnitType.Woodcutter];
        for (const unitType of carryingUnitTypes) {
            registry.registerAnimationSequence(
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

async function loadWorkerAnimations(
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number,
    race: Race,
    ctx: UnitLoadContext
): Promise<number> {
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
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas, paletteBaseOffset);
            return { unitType, workIndex, loadedDirs };
        })
    );

    for (const { unitType, workIndex, loadedDirs } of workerResults) {
        if (!loadedDirs) continue;
        const frames = toEntryMap(loadedDirs);
        if (frames.size > 0) batch.add({ unitType, seqKey: workSequenceKey(workIndex), frames });
    }

    let loadedCount = 0;
    batch.finalize(atlas, gl, data => {
        registry.registerAnimationSequence(
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
 * Load carry animations for workers that transport materials back to their building.
 * These use the worker's own carry sprite (e.g., farmer carrying grain, miner carrying stone)
 * rather than the generic carrier material variants.
 *
 * Skips Carrier and Woodcutter since they already have per-material carrier variants
 * registered by loadCarrierVariants.
 */
async function loadWorkerCarryAnimations(
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number,
    race: Race,
    ctx: UnitLoadContext
): Promise<number> {
    type CarryAnimData = { unitType: UnitType; directionFrames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<CarryAnimData>();

    // These unit types already have per-material carry variants from loadCarrierVariants
    const skipUnitTypes = new Set([UnitType.Carrier, UnitType.Woodcutter]);

    type CarryJob = { unitType: UnitType; jobIndex: number };
    const carryJobs: CarryJob[] = [];
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined || skipUnitTypes.has(unitType)) continue;

        const jobIndex = getFirstFieldByPrefix(workerData as SettlerAnimData, 'carry');
        if (jobIndex === undefined) continue;

        if (ctx.spriteLoader.getDirectionCount(fileSet, jobIndex) > 0) {
            carryJobs.push({ unitType, jobIndex });
        }
    }

    const results = await Promise.all(
        carryJobs.map(async({ unitType, jobIndex }) => {
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas, paletteBaseOffset);
            return { unitType, loadedDirs };
        })
    );

    for (const { unitType, loadedDirs } of results) {
        if (!loadedDirs) continue;
        const directionFrames = toEntryMap(loadedDirs);
        if (directionFrames.size > 0) batch.add({ unitType, directionFrames });
    }

    // Collect all material types that have carrier variants — these are the materials
    // that can appear as carry_X sequence keys
    const materialTypes = Object.keys(CARRIER_MATERIAL_JOB_INDICES)
        .map(Number)
        .filter(matId => isMaterialAvailableForRace(matId as EMaterialType, race));

    let loadedCount = 0;
    batch.finalize(atlas, gl, data => {
        // Register the same carry animation for all material types.
        // Workers use a single carry sprite regardless of what they're holding.
        for (const matId of materialTypes) {
            registry.registerAnimationSequence(
                EntityType.Unit,
                data.unitType,
                carrySequenceKey(matId),
                data.directionFrames,
                ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                true,
                race
            );
        }
        loadedCount++;
    });

    return loadedCount;
}

type FightJob = { unitType: UnitType; fightIndex: number; jobIndex: number };

/** Collect fight animation jobs from SETTLER_JOB_INDICES, using military level for fight index offset. */
function collectFightJobs(fileSet: LoadedGfxFileSet, race: Race, ctx: UnitLoadContext): FightJob[] {
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

async function loadFightAnimations(
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number,
    race: Race,
    ctx: UnitLoadContext
): Promise<number> {
    type FightAnimData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<FightAnimData>();

    const fightJobs = collectFightJobs(fileSet, race, ctx);

    const fightResults = await Promise.all(
        fightJobs.map(async({ unitType, fightIndex, jobIndex }) => {
            try {
                const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(
                    fileSet,
                    jobIndex,
                    atlas,
                    paletteBaseOffset
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
    batch.finalize(atlas, gl, data => {
        registry.registerAnimationSequence(
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
function collectMilitaryLevelJobs(
    fileSet: LoadedGfxFileSet,
    ctx: UnitLoadContext
): { unitType: UnitType; level: number; jobIndex: number }[] {
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
async function loadMilitaryLevelAnimations(
    fileSet: LoadedGfxFileSet,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    paletteBaseOffset: number,
    race: Race,
    ctx: UnitLoadContext
): Promise<number> {
    type LevelAnimData = { unitType: UnitType; seqKey: string; frames: Map<number, SpriteEntry[]> };
    const batch = new SafeLoadBatch<LevelAnimData>();

    const idleJobs = collectMilitaryLevelJobs(fileSet, ctx);

    const results = await Promise.all(
        idleJobs.map(async({ unitType, level, jobIndex }) => {
            const loadedDirs = await ctx.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas, paletteBaseOffset);
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
    batch.finalize(atlas, gl, data => {
        registry.registerAnimationSequence(
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

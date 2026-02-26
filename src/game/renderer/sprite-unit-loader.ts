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
    WORKER_JOB_INDICES,
} from './sprite-metadata';
import { SpriteLoader, type LoadedGfxFileSet, type LoadedSprite } from './sprite-loader';
import { UnitType, EntityType } from '../entity';
import { EMaterialType } from '../economy';
import { ANIMATION_DEFAULTS, carrySequenceKey, workSequenceKey } from '../animation';
import { isMaterialAvailableForRace } from '../race-availability';

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

    if (unitCount > 0 || carrierCount > 0 || workerCount > 0) {
        log.debug(`${Race[race]}: ${unitCount} units, ${carrierCount} carriers, ${workerCount} workers`);
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

/** Mapping from WORKER_JOB_INDICES keys to UnitType. */
const WORKER_KEY_TO_UNIT_TYPE: Record<string, UnitType> = {
    carrier: UnitType.Carrier,
    digger: UnitType.Digger,
    smith: UnitType.Smith,
    builder: UnitType.Builder,
    woodcutter: UnitType.Woodcutter,
    miner: UnitType.Miner,
    forester: UnitType.Forester,
    farmer: UnitType.Farmer,
    priest: UnitType.Priest,
    geologist: UnitType.Geologist,
    pioneer: UnitType.Pioneer,
    swordsman_1: UnitType.Swordsman,
    swordsman_2: UnitType.Swordsman,
    swordsman_3: UnitType.Swordsman,
    bowman_1: UnitType.Bowman,
    bowman_2: UnitType.Bowman,
    bowman_3: UnitType.Bowman,
    sawmillworker: UnitType.SawmillWorker,
};

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
    for (const [workerKey, workerData] of Object.entries(WORKER_JOB_INDICES)) {
        if (!('work' in workerData)) continue;
        const unitType = WORKER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        const workJobIndices = workerData.work as readonly number[];
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

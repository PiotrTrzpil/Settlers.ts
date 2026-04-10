/**
 * Overlay Data Loader
 *
 * Converts parsed XML BuildingPatch data into BuildingOverlayDef definitions
 * and populates the OverlayRegistry at startup.
 */

import { getGameDataLoader, type BuildingPatch, type BuildingInfo } from '@/resources/game-data';
import { raceIdToRace, getBuildingTypesByXmlId } from '../../data/game-data-access';
import { RACE_GFX_FILE } from '../../core/race';
import type { RaceId } from '@/resources/game-data';
import { OverlayCondition, OverlayLayer, type BuildingOverlayDef, type OverlaySpriteRef } from './types';
import type { OverlayRegistry } from './overlay-registry';
import { BUILDING_JOB_INDICES, OVERLAY_DIRECTION_BASE } from '../../renderer/sprite-metadata/jil-indices';
import { createLogger } from '@/utilities/logger';

const log = createLogger('OverlayDataLoader');

/** Default animation frame duration for permanent/event overlays (ms). */
const DEFAULT_FRAME_DURATION_MS = 80;

/** Game ticks to milliseconds conversion factor. */
const TICK_TO_MS = 20;

/** Flag animation speed: 12 fps → ~83ms per frame. */
const FLAG_FRAME_DURATION_MS = Math.round(1000 / 12);

/** Sentinel sprite ref for flag overlays — not used for JIL lookup. */
const FLAG_SPRITE_REF: OverlaySpriteRef = { gfxFile: 0, jobIndex: 0 };

/**
 * Direction overrides for buildings where the GFX direction order doesn't
 * match the XML patch order. Maps job name → actual GFX direction index.
 *
 * Determined by manual visual inspection of the GFX sprite data.
 * Only Castle is known to have this mismatch.
 */
const CASTLE_DIRECTION_OVERRIDES: ReadonlyMap<string, number> = new Map([
    // GFX directions don't match XML patch order for castle towers.
    ['BUILDING_CASTLE_TOWER1', 3], // back of top tower
    ['BUILDING_CASTLE_TOWER2', 4], // back of right tower
    ['BUILDING_CASTLE_TOWER3', 6], // back of left tower
    ['BUILDING_CASTLE_TOWER1_FRONTWALL', 2], // front of top tower
    // FRONTWALL (D5), TOWER2_FRONTWALL (D7), TOWER3_FRONTWALL (D8), DOOR (D9) match defaults
]);

const DIRECTION_OVERRIDES: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map([
    ['BUILDING_CASTLE', CASTLE_DIRECTION_OVERRIDES],
]);

/**
 * Build a sprite ref for a patch overlay.
 *
 * The direction index is normally derived from the patch's position in the
 * race-specific XML patch list: `directionIndex = 2 + patchIndex`.
 * For buildings with known GFX/XML mismatches, an override table is used.
 *
 * @param patchIndex Position of this patch in the race's XML patch list (0-based).
 * @param parentJobIndex The parent building's JIL job index.
 * @param buildingXmlId The building's XML ID (for direction override lookup).
 * @param jobName The patch's XML job name (for direction override lookup).
 */
function buildOverlaySpriteRef(
    gfxFile: number,
    patchIndex: number,
    parentJobIndex: number,
    buildingXmlId: string,
    jobName: string
): OverlaySpriteRef {
    const overrides = DIRECTION_OVERRIDES.get(buildingXmlId);
    const directionIndex = overrides?.get(jobName) ?? OVERLAY_DIRECTION_BASE + patchIndex;
    return {
        gfxFile,
        jobIndex: parentJobIndex,
        directionIndex,
    };
}

/**
 * Derive a short overlay key from the job name and building XML ID.
 * e.g. job="BUILDING_BAKERY_FIRE", xmlId="BUILDING_BAKERY" → "fire"
 */
function deriveOverlayKey(job: string, buildingXmlId: string): string {
    const prefix = buildingXmlId + '_';
    if (job.startsWith(prefix)) {
        return job.slice(prefix.length).toLowerCase();
    }
    return job.toLowerCase();
}

function patchTypeToCondition(type: string): OverlayCondition {
    switch (type) {
        case 'EVENT':
            return OverlayCondition.Working;
        case 'PERMANENT':
        case 'TIMED':
        default:
            return OverlayCondition.Always;
    }
}

/**
 * Create a flag overlay def for a building.
 * The pixel offset comes from the building's XML <flag> position.
 * YAML position overrides (if any) are applied at render time in overlay-resolution.ts.
 */
function createFlagDef(buildingInfo: BuildingInfo): BuildingOverlayDef {
    return {
        key: 'flag',
        layer: OverlayLayer.AboveBuilding,
        pixelOffsetX: 0,
        pixelOffsetY: 0,
        spriteRef: FLAG_SPRITE_REF,
        frameDurationMs: FLAG_FRAME_DURATION_MS,
        loop: true,
        condition: OverlayCondition.Always,
        teamColored: true,
        isFlag: true,
        tileOffsetX: buildingInfo.flag.xOffset,
        tileOffsetY: buildingInfo.flag.yOffset,
    };
}

/** Convert a single BuildingPatch to a BuildingOverlayDef. */
function patchToDef(
    patch: BuildingPatch,
    buildingXmlId: string,
    patchIndex: number,
    gfxFile: number,
    parentJobIndex: number
): BuildingOverlayDef {
    const spriteRef = buildOverlaySpriteRef(gfxFile, patchIndex, parentJobIndex, buildingXmlId, patch.job);
    const key = deriveOverlayKey(patch.job, buildingXmlId);
    const isEvent = patch.type === 'EVENT';

    return {
        key,
        layer: OverlayLayer.AboveBuilding,
        pixelOffsetX: 0,
        pixelOffsetY: 0,
        spriteRef,
        frameDurationMs: patch.ticks > 0 ? patch.ticks * TICK_TO_MS : DEFAULT_FRAME_DURATION_MS,
        loop: !isEvent,
        condition: patchTypeToCondition(patch.type),
        jobName: patch.job,
    };
}

/**
 * Convert a building's patches into overlay definitions.
 *
 * ## Direction index derivation
 *
 * Each building job in the GFX file stores directions in a DIL (Direction Index
 * List). The DIL reader's `getItems()` method returns a **compacted** array that
 * skips null entries. Only patches with a job name occupy a real DIL direction;
 * jobless patches correspond to null DIL slots and are skipped by compaction.
 *
 * The compacted direction index for a patch overlay is:
 *   `directionIndex = OVERLAY_DIRECTION_BASE + overlayIndex`
 * where `overlayIndex` counts only patches that have a job name (0-based).
 *
 * This is race-specific — each race has its own patch list, so the same overlay
 * name maps to different compacted directions for different races.
 *
 * Ensures unique keys by appending slot index on collision.
 */
function convertPatches(
    patches: readonly BuildingPatch[],
    buildingXmlId: string,
    gfxFile: number,
    parentJobIndex: number
): BuildingOverlayDef[] {
    const defs: BuildingOverlayDef[] = [];
    const usedKeys = new Set<string>();
    let overlayIndex = 0;

    for (const patch of patches) {
        if (!patch.job) {
            continue;
        }
        let def = patchToDef(patch, buildingXmlId, overlayIndex, gfxFile, parentJobIndex);
        // Ensure unique key within this building
        if (usedKeys.has(def.key)) {
            def = { ...def, key: `${def.key}_s${patch.slot}` };
        }
        usedKeys.add(def.key);
        defs.push(def);
        overlayIndex++;
    }

    return defs;
}

/**
 * Populate the overlay registry from loaded XML game data.
 * Safe to call when game data is not yet loaded — silently returns 0.
 */
/** Register overlays for all buildings of a single race. */
function registerRaceOverlays(
    registry: OverlayRegistry,
    raceId: RaceId,
    raceBuildingData: { buildings: Map<string, BuildingInfo> }
): number {
    const race = raceIdToRace(raceId);
    const gfxFile = RACE_GFX_FILE[race];
    let count = 0;

    for (const [buildingXmlId, buildingInfo] of raceBuildingData.buildings) {
        const buildingTypes = getBuildingTypesByXmlId(buildingXmlId);
        if (!buildingTypes) {
            continue;
        }

        for (const bt of buildingTypes) {
            const defs: BuildingOverlayDef[] = [];
            const parentJobIndex = BUILDING_JOB_INDICES[bt];

            // Animation patch overlays (smoke, fire, wheels, etc.)
            if (buildingInfo.patches.length > 0 && parentJobIndex !== undefined) {
                defs.push(...convertPatches(buildingInfo.patches, buildingXmlId, gfxFile, parentJobIndex));
            }

            // Flag overlay — all buildings carry a player flag
            defs.push(createFlagDef(buildingInfo));

            registry.register(bt, race, defs);
            count += defs.length;
        }
    }
    return count;
}

export function populateOverlayRegistry(registry: OverlayRegistry): number {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) {
        throw new Error('populateOverlayRegistry: game data must be loaded before overlay init');
    }

    const data = loader.getData();
    let totalRegistered = 0;

    for (const [raceId, raceBuildingData] of data.buildings) {
        totalRegistered += registerRaceOverlays(registry, raceId, raceBuildingData);
    }

    log.debug(`Registered ${totalRegistered} overlay defs across all races`);
    return totalRegistered;
}

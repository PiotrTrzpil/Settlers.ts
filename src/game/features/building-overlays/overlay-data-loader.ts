/**
 * Overlay Data Loader
 *
 * Converts parsed XML BuildingPatch data into BuildingOverlayDef definitions
 * and populates the OverlayRegistry at startup.
 */

import { getGameDataLoader, type BuildingPatch, type BuildingInfo } from '@/resources/game-data';
import { raceIdToRace, getBuildingTypesByXmlId } from '../../game-data-access';
import type { RaceId } from '@/resources/game-data';
import { OverlayCondition, OverlayLayer, type BuildingOverlayDef, type OverlaySpriteRef } from './types';
import type { OverlayRegistry } from './overlay-registry';
import { BUILDING_OVERLAY_JIL_INDICES } from '../../renderer/sprite-metadata/jil-indices';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('OverlayDataLoader');

/** Default animation frame duration for permanent/event overlays (ms). */
const DEFAULT_FRAME_DURATION_MS = 80;

/** Game ticks to milliseconds conversion factor. */
const TICK_TO_MS = 20;

/** Flag animation speed: 12 fps → ~83ms per frame. */
const FLAG_FRAME_DURATION_MS = Math.round(1000 / 12);

/** Sentinel sprite ref for flag overlays — not used for JIL lookup. */
const FLAG_SPRITE_REF: OverlaySpriteRef = { gfxFile: 0, jobIndex: 0 };

/**
 * Resolve a patch job name to a sprite ref.
 * Returns null if the JIL index is not yet mapped (value -1 in BUILDING_OVERLAY_JIL_INDICES).
 */
function resolveOverlaySpriteRef(jobName: string, gfxFile: number): OverlaySpriteRef | null {
    const jobIndex = BUILDING_OVERLAY_JIL_INDICES[jobName];
    if (jobIndex === undefined || jobIndex < 0) return null;
    return { gfxFile, jobIndex };
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
        layer: OverlayLayer.Flag,
        pixelOffsetX: buildingInfo.flag.xOffset,
        pixelOffsetY: buildingInfo.flag.yOffset,
        spriteRef: FLAG_SPRITE_REF,
        frameDurationMs: FLAG_FRAME_DURATION_MS,
        loop: true,
        condition: OverlayCondition.Always,
        teamColored: true,
        isFlag: true,
    };
}

/** Convert a single BuildingPatch to a BuildingOverlayDef. Returns null if JIL index not yet mapped. */
function patchToDef(
    patch: BuildingPatch,
    buildingXmlId: string,
    slot: number,
    gfxFile: number
): BuildingOverlayDef | null {
    const spriteRef = resolveOverlaySpriteRef(patch.job, gfxFile);
    if (!spriteRef) return null;

    const key = deriveOverlayKey(patch.job, buildingXmlId);
    const isEvent = patch.type === 'EVENT';

    return {
        key: slot > 0 ? `${key}_s${slot}` : key,
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
 * Skips patches whose JIL index is not yet mapped (returns null from patchToDef).
 * Ensures unique keys by appending slot index on collision.
 */
function convertPatches(
    patches: readonly BuildingPatch[],
    buildingXmlId: string,
    gfxFile: number
): BuildingOverlayDef[] {
    const defs: BuildingOverlayDef[] = [];
    const usedKeys = new Set<string>();

    for (const patch of patches) {
        if (!patch.job) continue;
        let def = patchToDef(patch, buildingXmlId, 0, gfxFile);
        if (!def) continue; // JIL index not yet mapped — skip until filled in
        // Ensure unique key within this building
        if (usedKeys.has(def.key)) {
            def = { ...def, key: `${def.key}_s${patch.slot}` };
        }
        usedKeys.add(def.key);
        defs.push(def);
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
    const gfxFile = race as number; // Race enum values equal the GFX file number (10=Roman, 11=Viking, etc.)
    let count = 0;

    for (const [buildingXmlId, buildingInfo] of raceBuildingData.buildings) {
        const buildingTypes = getBuildingTypesByXmlId(buildingXmlId);
        if (!buildingTypes) continue;

        const defs: BuildingOverlayDef[] = [];

        // Animation patch overlays (smoke, fire, wheels, etc.)
        if (buildingInfo.patches.length > 0) {
            defs.push(...convertPatches(buildingInfo.patches, buildingXmlId, gfxFile));
        }

        // Flag overlay — all buildings carry a player flag
        defs.push(createFlagDef(buildingInfo));

        for (const bt of buildingTypes) {
            registry.register(bt, race, defs);
            count += defs.length;
        }
    }
    return count;
}

export function populateOverlayRegistry(registry: OverlayRegistry): number {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) return 0;

    const data = loader.getData();
    let totalRegistered = 0;

    for (const [raceId, raceBuildingData] of data.buildings) {
        totalRegistered += registerRaceOverlays(registry, raceId, raceBuildingData);
    }

    log.debug(`Registered ${totalRegistered} overlay defs across all races`);
    return totalRegistered;
}

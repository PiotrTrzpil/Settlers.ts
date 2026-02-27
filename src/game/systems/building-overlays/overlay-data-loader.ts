/**
 * Overlay Data Loader
 *
 * Converts parsed XML BuildingPatch data into BuildingOverlayDef definitions
 * and populates the OverlayRegistry at startup.
 */

import { getGameDataLoader, type BuildingPatch } from '@/resources/game-data';
import { raceIdToRace, getBuildingTypesByXmlId } from '../../game-data-access';
import type { RaceId } from '@/resources/game-data';
import { OverlayCondition, OverlayLayer, type BuildingOverlayDef, type OverlaySpriteRef } from './types';
import type { OverlayRegistry } from './overlay-registry';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('OverlayDataLoader');

/** Default animation frame duration for permanent/event overlays (ms). */
const DEFAULT_FRAME_DURATION_MS = 80;

/** Game ticks to milliseconds conversion factor. */
const TICK_TO_MS = 20;

/** Placeholder sprite ref — resolved later when JIL pipeline is connected. */
const PLACEHOLDER_SPRITE: OverlaySpriteRef = { gfxFile: 0, jobIndex: 0 };

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

/** Convert a single BuildingPatch to a BuildingOverlayDef. */
function patchToDef(patch: BuildingPatch, buildingXmlId: string, slot: number): BuildingOverlayDef {
    const key = deriveOverlayKey(patch.job, buildingXmlId);
    const isEvent = patch.type === 'EVENT';

    return {
        key: slot > 0 ? `${key}_s${slot}` : key,
        layer: OverlayLayer.AboveBuilding,
        pixelOffsetX: 0,
        pixelOffsetY: 0,
        spriteRef: PLACEHOLDER_SPRITE,
        frameDurationMs: patch.ticks > 0 ? patch.ticks * TICK_TO_MS : DEFAULT_FRAME_DURATION_MS,
        loop: !isEvent,
        condition: patchTypeToCondition(patch.type),
        jobName: patch.job,
    };
}

/**
 * Convert a building's patches into overlay definitions.
 * Ensures unique keys by appending slot index on collision.
 */
function convertPatches(patches: readonly BuildingPatch[], buildingXmlId: string): BuildingOverlayDef[] {
    const defs: BuildingOverlayDef[] = [];
    const usedKeys = new Set<string>();

    for (const patch of patches) {
        if (!patch.job) continue;
        let def = patchToDef(patch, buildingXmlId, 0);
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
    raceBuildingData: { buildings: Map<string, { patches: readonly BuildingPatch[] }> }
): number {
    const race = raceIdToRace(raceId);
    let count = 0;

    for (const [buildingXmlId, buildingInfo] of raceBuildingData.buildings) {
        if (buildingInfo.patches.length === 0) continue;

        const defs = convertPatches(buildingInfo.patches, buildingXmlId);
        if (defs.length === 0) continue;

        const buildingTypes = getBuildingTypesByXmlId(buildingXmlId);
        if (!buildingTypes) continue;

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

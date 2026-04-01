/**
 * Settler Data Access — derives settler task configs from SettlerValues.xml.
 *
 * Maps XML settler role + searchType → our SearchType + jobs for the task system.
 */

import { getGameDataLoader, type RaceId, type SettlerValueInfo } from '@/resources/game-data';
import { Race } from '../core/race';
import { UnitType, UNIT_TYPE_CONFIG, isUnitTypeMilitary } from '../core/unit-types';
import { BuildingType } from '../buildings/building-type';
import { SearchType, DISPATCH_ONLY_CONFIG, type SettlerConfig } from '../features/settler-tasks/types';
import { raceToRaceId, xmlIdToBuildingTypes } from './game-data-access';

/**
 * UnitType → XML settler ID for worker settlers managed by the task system.
 */
const UNIT_TYPE_TO_XML_SETTLER: Partial<Record<UnitType, string>> = {
    [UnitType.Woodcutter]: 'SETTLER_WOODCUTTER',
    [UnitType.Stonecutter]: 'SETTLER_STONECUTTER',
    [UnitType.Forester]: 'SETTLER_FORESTER',
    [UnitType.Farmer]: 'SETTLER_FARMERGRAIN',
    [UnitType.AgaveFarmer]: 'SETTLER_AGAVEFARMER',
    [UnitType.Beekeeper]: 'SETTLER_BEEKEEPER',
    [UnitType.Miner]: 'SETTLER_MINEWORKER',
    [UnitType.Carrier]: 'SETTLER_CARRIER',
    [UnitType.Builder]: 'SETTLER_BUILDER',
    [UnitType.Digger]: 'SETTLER_DIGGER',
    [UnitType.Smith]: 'SETTLER_SMITH',
    [UnitType.SawmillWorker]: 'SETTLER_SAWMILLWORKER',
    [UnitType.Miller]: 'SETTLER_MILLER',
    [UnitType.Butcher]: 'SETTLER_BUTCHER',
    [UnitType.Winemaker]: 'SETTLER_VINTNER',
    [UnitType.Meadmaker]: 'SETTLER_MEADMAKER',
    [UnitType.Tequilamaker]: 'SETTLER_TEQUILAMAKER',
    [UnitType.Smelter]: 'SETTLER_SMELTER',
    [UnitType.Waterworker]: 'SETTLER_WATERWORKER',
    [UnitType.Baker]: 'SETTLER_BAKER',
    [UnitType.AnimalFarmer]: 'SETTLER_FARMERANIMALS',
    [UnitType.SunflowerFarmer]: 'SETTLER_SUNFLOWERFARMER',
    [UnitType.TempleServant]: 'SETTLER_TEMPLE_SERVANT',
    [UnitType.Geologist]: 'SETTLER_GEOLOGIST',
};

const ALL_RACE_IDS: RaceId[] = ['RACE_ROMAN', 'RACE_VIKING', 'RACE_MAYA', 'RACE_DARK', 'RACE_TROJAN'];

/** Map from XML SEARCH_* value (prefix stripped) to our SearchType enum. */
const XML_SEARCH_TO_SEARCH_TYPE: Record<string, SearchType> = {
    TREE: SearchType.TREE,
    TREE_SEED_POS: SearchType.TREE_SEED_POS,
    GRAIN_SEED_POS: SearchType.GRAIN_SEED_POS,
    SUNFLOWER_SEED_POS: SearchType.SUNFLOWER_SEED_POS,
    AGAVE_SEED_POS: SearchType.AGAVE_SEED_POS,
    BEEHIVE_SEED_POS: SearchType.BEEHIVE_SEED_POS,
    VINE_SEED_POS: SearchType.VINE_SEED_POS,
    STONE: SearchType.STONE,
    FISH: SearchType.FISH,
    VENISON: SearchType.VENISON,
    GRAIN: SearchType.GRAIN,
    SUNFLOWER: SearchType.SUNFLOWER,
    AGAVE: SearchType.AGAVE,
    BEEHIVE: SearchType.BEEHIVE,
    RESOURCE_POS: SearchType.RESOURCE_POS,
    GOOD: SearchType.GOOD,
    VINE: SearchType.VINE,
    WATER: SearchType.WATER,
};

/** Job ID patterns that are NOT work jobs (idle behaviors, check-in routines). */
const NON_WORK_JOB_PATTERNS = ['CHECKIN', 'IDLE', 'STRIKE'];

/** Filter animLists to work jobs only, excluding check-in, idle, and strike variants. */
function filterWorkJobs(animLists: string[]): string[] {
    return animLists.filter(jobId => {
        const upper = jobId.toUpperCase();
        return !NON_WORK_JOB_PATTERNS.some(pattern => upper.includes(pattern));
    });
}

/**
 * Derive the SearchType for a settler from its XML role and searchTypes.
 * Returns null if the settler has no actionable search type.
 */
function deriveSearchType(info: SettlerValueInfo): SearchType | null {
    // Role-based fixed search types
    switch (info.role) {
        case 'CARRIER_ROLE':
            return SearchType.GOOD;
        case 'BUILDER_ROLE':
            return SearchType.CONSTRUCTION;
        case 'DIGGER_ROLE':
            return SearchType.CONSTRUCTION_DIG;
        case 'HOUSE_WORKER_ROLE':
            return SearchType.WORKPLACE;
    }

    // Free workers — derive from XML search types
    const searchTypes = info.searchTypes.filter(s => s !== 'SEARCH_NO_SEARCH');
    if (searchTypes.length === 0) {
        return null;
    }

    const nonSeed = searchTypes.find(s => !s.endsWith('_SEED_POS'));
    const primaryXml = nonSeed ?? searchTypes[0]!;
    const searchKey = primaryXml.replace('SEARCH_', '');
    const result = XML_SEARCH_TO_SEARCH_TYPE[searchKey];
    if (!result) {
        throw new Error(`Unknown XML search type '${primaryXml}' — no mapping in XML_SEARCH_TO_SEARCH_TYPE`);
    }
    return result;
}

/**
 * Derive a SettlerConfig from raw XML settler data.
 * Maps XML role + searchType → our SearchType; derives jobs from animLists.
 *
 * Some settlers (e.g. SETTLER_MINEWORKER) have no work animLists in their own XML —
 * the S4 game stores their jobs in the building XML instead. For these, we fall back
 * to collecting animLists from buildings that employ this settler.
 */
function deriveSettlerConfig(info: SettlerValueInfo, settlerXmlId: string): SettlerConfig | null {
    const search = deriveSearchType(info);
    if (search === null) {
        return null;
    }

    let workJobs = filterWorkJobs(info.animLists);
    let buildingJobsMap: Map<BuildingType, string[]> | undefined;

    // Settlers with no own work jobs: pull from building XML (e.g. miners)
    if (workJobs.length === 0) {
        const { allJobs, buildingJobs } = collectBuildingAnimLists(settlerXmlId);
        workJobs = allJobs;
        if (buildingJobs.size > 0) {
            buildingJobsMap = buildingJobs;
        }
    } else {
        // Settlers that serve multiple building types (e.g. smelter → IronSmelter + SmeltGold,
        // smith → ToolSmith + WeaponSmith) list all jobs in their own animLists. We still need
        // the per-building job map so selectJob picks only the correct building's jobs.
        const { buildingJobs } = collectBuildingAnimLists(settlerXmlId);
        if (buildingJobs.size > 1) {
            buildingJobsMap = buildingJobs;
        }
    }

    // Derive plant/seed search type for dual-mode settlers (farmer, forester)
    const seedXml = info.searchTypes.find(s => s.endsWith('_SEED_POS'));
    let plantSearch: SearchType | undefined;
    if (seedXml) {
        const key = seedXml.replace('SEARCH_', '');
        const mapped = XML_SEARCH_TO_SEARCH_TYPE[key];
        if (!mapped) {
            throw new Error(`Unknown XML seed search type '${seedXml}' — no mapping in XML_SEARCH_TO_SEARCH_TYPE`);
        }
        plantSearch = mapped;
    }

    return { search, jobs: workJobs, plantSearch, buildingJobs: buildingJobsMap };
}

/** Find settler info across all races (race-specific settlers only exist in their race). */
function findSettlerInfoAnyRace(xmlId: string): SettlerValueInfo | undefined {
    const loader = getGameDataLoader();
    for (const raceId of ALL_RACE_IDS) {
        const info = loader.getSettler(raceId, xmlId);
        if (info) {
            return info;
        }
    }
    return undefined;
}

/**
 * Collect work animLists from buildings that employ a given settler XML ID.
 * Used for settlers like SETTLER_MINEWORKER whose jobs are stored in building XML,
 * not in the settler's own XML entry.
 *
 * Returns both a flat job list and a per-BuildingType map so selectJob can
 * filter to only the jobs relevant to the settler's assigned building.
 */
/** Scan one race's buildings for settler jobs; returns true when any were found. */
function collectBuildingJobsForRace(
    raceId: RaceId,
    settlerXmlId: string,
    allJobs: string[],
    buildingJobs: Map<BuildingType, string[]>
): boolean {
    const buildings = getGameDataLoader().getBuildingsForRace(raceId);
    if (!buildings) {
        return false;
    }
    for (const buildingInfo of buildings.values()) {
        if (buildingInfo.inhabitant !== settlerXmlId || buildingInfo.animLists.length === 0) {
            continue;
        }
        const workJobs = filterWorkJobs(buildingInfo.animLists);
        if (workJobs.length === 0) {
            continue;
        }
        allJobs.push(...workJobs);
        for (const bt of xmlIdToBuildingTypes(buildingInfo.id)) {
            buildingJobs.set(bt, workJobs);
        }
    }
    return allJobs.length > 0;
}

function collectBuildingAnimLists(settlerXmlId: string): {
    allJobs: string[];
    buildingJobs: Map<BuildingType, string[]>;
} {
    const allJobs: string[] = [];
    const buildingJobs = new Map<BuildingType, string[]>();
    for (const raceId of ALL_RACE_IDS) {
        if (collectBuildingJobsForRace(raceId, settlerXmlId, allJobs, buildingJobs)) {
            break;
        }
    }
    return { allJobs, buildingJobs };
}

/**
 * Get the task-system config for a settler type from SettlerValues.xml.
 * Returns undefined if the unit type is not a managed worker.
 */
export function getSettlerConfig(race: Race, unitType: UnitType): SettlerConfig | undefined {
    const xmlId = UNIT_TYPE_TO_XML_SETTLER[unitType];
    if (!xmlId) {
        return undefined;
    }

    const loader = getGameDataLoader();
    if (!loader.isLoaded()) {
        throw new Error('getSettlerConfig called before game data is loaded');
    }

    // Try specific race first, then any race (settler may only exist in one race's XML)
    const raceId = raceToRaceId(race);
    const info = loader.getSettler(raceId, xmlId) ?? findSettlerInfoAnyRace(xmlId);
    if (!info) {
        return undefined;
    }

    return deriveSettlerConfig(info, xmlId) ?? undefined;
}

/**
 * Build a Map of all managed settler configs (across all races).
 * Military units get DISPATCH_ONLY_CONFIG so they can execute
 * externally-assigned choreo jobs (garrison dispatch, etc.).
 */
export function buildAllSettlerConfigs(): Map<UnitType, SettlerConfig> {
    const configs = new Map<UnitType, SettlerConfig>();

    for (const unitTypeStr of Object.keys(UNIT_TYPE_TO_XML_SETTLER)) {
        const unitType = unitTypeStr as UnitType;
        const xmlId = UNIT_TYPE_TO_XML_SETTLER[unitType]!;
        const info = findSettlerInfoAnyRace(xmlId);
        if (!info) {
            continue;
        }

        const config = deriveSettlerConfig(info, xmlId);
        if (config) {
            configs.set(unitType, config);
        }
    }

    // Military units: no autonomous work, but can execute dispatch jobs.
    for (const unitType of Object.keys(UNIT_TYPE_CONFIG)) {
        const ut = unitType as UnitType;
        if (!configs.has(ut) && isUnitTypeMilitary(ut)) {
            configs.set(ut, DISPATCH_ONLY_CONFIG);
        }
    }

    return configs;
}

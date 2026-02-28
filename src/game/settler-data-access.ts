/**
 * Settler Data Access — derives settler task configs from SettlerValues.xml.
 *
 * Maps XML settler role + searchType → our SearchType + jobs for the task system.
 */

import { getGameDataLoader, type RaceId, type SettlerValueInfo } from '@/resources/game-data';
import { Race } from './race';
import { UnitType } from './unit-types';
import { SearchType, type SettlerConfig } from './features/settler-tasks/types';
import { raceToRaceId } from './game-data-access';

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
    [UnitType.TempleServant]: 'SETTLER_TEMPLE_SERVANT',
};

const ALL_RACE_IDS: RaceId[] = ['RACE_ROMAN', 'RACE_VIKING', 'RACE_MAYA', 'RACE_DARK', 'RACE_TROJAN'];

/** Map from XML SEARCH_* value (prefix stripped) to our SearchType enum. */
const XML_SEARCH_TO_SEARCH_TYPE: Record<string, SearchType> = {
    TREE: SearchType.TREE,
    TREE_SEED_POS: SearchType.TREE_SEED_POS,
    GRAIN_SEED_POS: SearchType.GRAIN_SEED_POS,
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
        return SearchType.TERRAIN;
    case 'HOUSE_WORKER_ROLE':
        return SearchType.WORKPLACE;
    }

    // Free workers — derive from XML search types
    const searchTypes = info.searchTypes.filter(s => s !== 'SEARCH_NO_SEARCH');
    if (searchTypes.length === 0) return null;

    const nonSeed = searchTypes.find(s => !s.endsWith('_SEED_POS'));
    const primaryXml = nonSeed ?? searchTypes[0]!;
    const searchKey = primaryXml.replace('SEARCH_', '');
    return XML_SEARCH_TO_SEARCH_TYPE[searchKey] ?? null;
}

/**
 * Derive a SettlerConfig from raw XML settler data.
 * Maps XML role + searchType → our SearchType; derives jobs from animLists.
 */
function deriveSettlerConfig(info: SettlerValueInfo): SettlerConfig | null {
    const search = deriveSearchType(info);
    if (search === null) return null;

    const workJobs = filterWorkJobs(info.animLists);

    // Derive plant/seed search type for dual-mode settlers (farmer, forester)
    const seedXml = info.searchTypes.find(s => s.endsWith('_SEED_POS'));
    let plantSearch: SearchType | undefined;
    if (seedXml) {
        const key = seedXml.replace('SEARCH_', '');
        plantSearch = XML_SEARCH_TO_SEARCH_TYPE[key];
    }

    return { search, jobs: workJobs, plantSearch };
}

/** Find settler info across all races (race-specific settlers only exist in their race). */
function findSettlerInfoAnyRace(xmlId: string): SettlerValueInfo | undefined {
    const loader = getGameDataLoader();
    for (const raceId of ALL_RACE_IDS) {
        const info = loader.getSettler(raceId, xmlId);
        if (info) return info;
    }
    return undefined;
}

/**
 * Get the task-system config for a settler type from SettlerValues.xml.
 * Returns undefined if the unit type is not a managed worker.
 */
export function getSettlerConfig(race: Race, unitType: UnitType): SettlerConfig | undefined {
    const xmlId = UNIT_TYPE_TO_XML_SETTLER[unitType];
    if (!xmlId) return undefined;

    const loader = getGameDataLoader();
    if (!loader.isLoaded()) throw new Error('getSettlerConfig called before game data is loaded');

    // Try specific race first, then any race (settler may only exist in one race's XML)
    const raceId = raceToRaceId(race);
    const info = loader.getSettler(raceId, xmlId) ?? findSettlerInfoAnyRace(xmlId);
    if (!info) return undefined;

    return deriveSettlerConfig(info) ?? undefined;
}

/**
 * Build a Map of all managed settler configs (across all races).
 */
export function buildAllSettlerConfigs(): Map<UnitType, SettlerConfig> {
    const configs = new Map<UnitType, SettlerConfig>();

    for (const unitTypeStr of Object.keys(UNIT_TYPE_TO_XML_SETTLER)) {
        const unitType = Number(unitTypeStr) as UnitType;
        const xmlId = UNIT_TYPE_TO_XML_SETTLER[unitType]!;
        const info = findSettlerInfoAnyRace(xmlId);
        if (!info) continue;

        const config = deriveSettlerConfig(info);
        if (config) configs.set(unitType, config);
    }

    return configs;
}

/**
 * Settler Data Access — derives settler task configs from SettlerValues.xml.
 *
 * Maps XML settler role + searchType → our SearchType + jobs for the task system.
 * Replaces the old settlers.yaml loader.
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

/**
 * Overrides for settlers whose XML role/searchType doesn't match our task system config.
 * The miner is HOUSE_WORKER_ROLE in XML (search type stored in the building), but our
 * task system treats it as a RESOURCE_POS worker.
 */
const SETTLER_CONFIG_OVERRIDES: Partial<Record<string, SettlerConfig>> = {
    SETTLER_MINEWORKER: { search: SearchType.RESOURCE_POS, jobs: ['work'] },
};

/** Map from XML SEARCH_* value (prefix stripped) to our SearchType enum. */
const XML_SEARCH_TO_SEARCH_TYPE: Record<string, SearchType> = {
    TREE: SearchType.TREE,
    TREE_SEED_POS: SearchType.TREE_SEED_POS,
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

/**
 * Derive a SettlerConfig from raw XML settler data.
 * Maps XML role + searchType → our SearchType + jobs.
 */
function deriveSettlerConfig(info: SettlerValueInfo): SettlerConfig | null {
    // Check overrides first
    const override = SETTLER_CONFIG_OVERRIDES[info.id];
    if (override) return override;

    // Role-based fixed configs
    switch (info.role) {
    case 'CARRIER_ROLE':
        return { search: SearchType.GOOD, jobs: ['transport'] };
    case 'BUILDER_ROLE':
        return { search: SearchType.CONSTRUCTION, jobs: ['build'] };
    case 'DIGGER_ROLE':
        return { search: SearchType.TERRAIN, jobs: ['dig'] };
    case 'HOUSE_WORKER_ROLE':
        return { search: SearchType.WORKPLACE, jobs: ['station'] };
    }

    // Free workers — derive from XML search types
    const searchTypes = info.searchTypes.filter(s => s !== 'SEARCH_NO_SEARCH');
    if (searchTypes.length === 0) return null;

    const nonSeed = searchTypes.find(s => !s.endsWith('_SEED_POS'));
    const seed = searchTypes.find(s => s.endsWith('_SEED_POS'));

    // Primary search: prefer non-seed, fall back to seed
    const primaryXml = nonSeed ?? seed!;
    const searchKey = primaryXml.replace('SEARCH_', '');
    const search = XML_SEARCH_TO_SEARCH_TYPE[searchKey];
    if (!search) return null;

    // Jobs: both seed and non-seed → [plant, harvest]; only seed → [plant]; otherwise → [work]
    let jobs: string[];
    if (nonSeed && seed) {
        jobs = ['plant', 'harvest'];
    } else if (seed) {
        jobs = ['plant'];
    } else {
        jobs = ['work'];
    }

    return { search, jobs };
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
 * Replaces loadSettlerConfigs() from the YAML loader.
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

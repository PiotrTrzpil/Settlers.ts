/**
 * Test helper: injects minimal game data into the GameDataLoader singleton.
 *
 * Provides building info with inhabitant/tool fields matching the original XML
 * so that getBuildingWorkerInfo() works in unit tests without loading real XML files.
 */

import { GameDataLoader } from '@/resources/game-data/game-data-loader';
import type {
    GameData,
    BuildingInfo,
    RaceId,
    SettlerValueInfo,
    RaceSettlerValueData,
    JobInfo,
    JobNode,
    RaceJobData,
} from '@/resources/game-data/types';
import { clearWorkerBuildingCache } from '@/game/game-data-access';
import { loadGameDataFromFiles } from '@/resources/game-data/load-game-data-from-files';
import { existsSync } from 'fs';
import { resolve } from 'path';

/** Minimal BuildingInfo with only the fields needed for worker resolution. */
function buildingInfo(id: string, inhabitant: string, tool: string): BuildingInfo {
    return {
        id,
        inhabitant,
        tool,
        // Required fields with zero defaults (not used by worker resolution)
        hotSpotX: 0,
        hotSpotY: 0,
        stone: 0,
        boards: 0,
        gold: 0,
        lines: 0,
        buildingPosLines: [],
        digPosLines: [],
        repealingPosLines: [],
        blockPosLines: [],
        waterPosLines: [],
        boundingRect: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        builderNumber: 0,
        flag: { xOffset: 0, yOffset: 0 },
        door: { xOffset: 0, yOffset: 0 },
        workingPos: { xOffset: 0, yOffset: 0 },
        miniFlag: { xOffset: 0, yOffset: 0 },
        pileNumber: 0,
        kind: '',
        productionDelay: 0,
        influenceRadius: 0,
        explorerRadius: 0,
        workingAreaRadius: 0,
        calcProd: false,
        settlerNumber: 0,
        hitpoints: 0,
        armor: 0,
        patchSettlerSlot: 0,
        waterFreePosLines: [],
        waterBlockPosLines: [],
        patches: [],
        settlers: [],
        animLists: [],
        piles: [],
        builderInfos: [],
        dummyValue: 0,
        gridChangedForExport: 0,
        gridVersion: 0,
        helperFile: '',
        helperX: 0,
        helperY: 0,
    };
}

/**
 * Building definitions matching buildingInfo.xml.
 * Only includes buildings that have a non-empty inhabitant (worker buildings).
 */
const TEST_BUILDINGS: BuildingInfo[] = [
    buildingInfo('BUILDING_WOODCUTTERHUT', 'SETTLER_WOODCUTTER', 'GOOD_AXE'),
    buildingInfo('BUILDING_FORESTERHUT', 'SETTLER_FORESTER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_SAWMILL', 'SETTLER_SAWMILLWORKER', 'GOOD_SAW'),
    buildingInfo('BUILDING_STONECUTTERHUT', 'SETTLER_STONECUTTER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_GRAINFARM', 'SETTLER_FARMERGRAIN', 'GOOD_SCYTHE'),
    buildingInfo('BUILDING_MILL', 'SETTLER_MILLER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_BAKERY', 'SETTLER_BAKER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_FISHERHUT', 'SETTLER_FISHER', 'GOOD_ROD'),
    buildingInfo('BUILDING_ANIMALRANCH', 'SETTLER_FARMERANIMALS', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_SLAUGHTERHOUSE', 'SETTLER_BUTCHER', 'GOOD_AXE'),
    buildingInfo('BUILDING_WATERWORKHUT', 'SETTLER_WATERWORKER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_COALMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_IRONMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_GOLDMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_SULFURMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_STONEMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_SMELTIRON', 'SETTLER_SMELTER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_SMELTGOLD', 'SETTLER_SMELTER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_WEAPONSMITH', 'SETTLER_SMITH', 'GOOD_HAMMER'),
    buildingInfo('BUILDING_TOOLSMITH', 'SETTLER_SMITH', 'GOOD_HAMMER'),
    buildingInfo('BUILDING_AMMOMAKERHUT', 'SETTLER_AMMOMAKER', 'GOOD_PICKAXE'),
    buildingInfo('BUILDING_HUNTERHUT', 'SETTLER_HUNTER', 'GOOD_BOW'),
    buildingInfo('BUILDING_HEALERHUT', 'SETTLER_HEALER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_DONKEYRANCH', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_VEHICLEHALL', 'SETTLER_VEHICLEMAKER', 'GOOD_HAMMER'),
    buildingInfo('BUILDING_VINYARD', 'SETTLER_VINTNER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_AGAVEFARMERHUT', 'SETTLER_AGAVEFARMER', 'GOOD_SCYTHE'),
    buildingInfo('BUILDING_TEQUILAMAKERHUT', 'SETTLER_TEQUILAMAKER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_BEEKEEPERHUT', 'SETTLER_BEEKEEPER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_MEADMAKERHUT', 'SETTLER_MEADMAKER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_SUNFLOWERFARMERHUT', 'SETTLER_SUNFLOWERFARMER', 'GOOD_SCYTHE'),
    buildingInfo('BUILDING_SUNFLOWEROILMAKERHUT', 'SETTLER_SUNFLOWEROILMAKER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_MUSHROOMFARM', 'SETTLER_MUSHROOMFARMER', 'GOOD_NO_GOOD'),
    // Military / residential buildings (inhabitant = CARRIER, no tool)
    buildingInfo('BUILDING_STORAGEAREA', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_RESIDENCESMALL', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_RESIDENCEMEDIUM', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_RESIDENCEBIG', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_BARRACKS', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_SMALLTEMPLE', 'SETTLER_TEMPLE_SERVANT', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_BIGTEMPLE', 'SETTLER_TEMPLE_SERVANT', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_CASTLE', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_GUARDTOWERSMALL', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_GUARDTOWERBIG', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_FORTRESS', 'SETTLER_CARRIER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_LOOKOUTTOWER', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_DARKTEMPLE', 'SETTLER_TEMPLE_SERVANT', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_MANACOPTERHALL', 'SETTLER_MANACOPTERMASTER', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_SHIPYARDA', 'SETTLER_SHIPYARDWORKER', 'GOOD_HAMMER'),
    // Eyecatchers (decorative monuments — no workers)
    buildingInfo('BUILDING_EYECATCHER01', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER02', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER03', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER04', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER05', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER06', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER07', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER08', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER09', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER10', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER11', '', 'GOOD_NO_GOOD'),
    buildingInfo('BUILDING_EYECATCHER12', '', 'GOOD_NO_GOOD'),
];

/** Build a race building map from the test building definitions. */
function buildRaceBuildingMap(): Map<string, BuildingInfo> {
    const map = new Map<string, BuildingInfo>();
    for (const b of TEST_BUILDINGS) {
        map.set(b.id, b);
    }
    return map;
}

/** Minimal SettlerValueInfo with only the fields needed for config derivation. */
function settlerValue(id: string, role: string, searchTypes: string[], animLists: string[] = []): SettlerValueInfo {
    return { id, role, searchTypes, tool: '', animLists };
}

/**
 * Settler value entries matching SettlerValues.xml.
 * Only includes settlers managed by the task system.
 * Roman race has most settlers; race-specific ones go in their own race.
 */
const ROMAN_SETTLERS: SettlerValueInfo[] = [
    settlerValue(
        'SETTLER_WOODCUTTER',
        'FREE_WORKER_ROLE',
        ['SEARCH_TREE'],
        ['JOB_WOODCUTTER_CHECKIN', 'JOB_WOODCUTTER_WORK']
    ),
    settlerValue(
        'SETTLER_STONECUTTER',
        'FREE_WORKER_ROLE',
        ['SEARCH_STONE'],
        ['JOB_STONECUTTER_CHECKIN', 'JOB_STONECUTTER_WORK']
    ),
    settlerValue(
        'SETTLER_FORESTER',
        'FREE_WORKER_ROLE',
        ['SEARCH_NO_SEARCH', 'SEARCH_TREE_SEED_POS'],
        ['JOB_FORESTER_CHECKIN', 'JOB_FORESTER_PLANT']
    ),
    settlerValue(
        'SETTLER_FARMERGRAIN',
        'FREE_WORKER_ROLE',
        ['SEARCH_GRAIN', 'SEARCH_GRAIN_SEED_POS'],
        ['JOB_FARMERGRAIN_CHECKIN', 'JOB_FARMERGRAIN_HARVEST', 'JOB_FARMERGRAIN_PLANT']
    ),
    settlerValue('SETTLER_MINEWORKER', 'HOUSE_WORKER_ROLE', []),
    settlerValue('SETTLER_CARRIER', 'CARRIER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_BUILDER', 'BUILDER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_DIGGER', 'DIGGER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_SMITH', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_SAWMILLWORKER', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_MILLER', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_BUTCHER', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_VINTNER', 'FREE_WORKER_ROLE', ['SEARCH_VINE', 'SEARCH_VINE_SEED_POS']),
    settlerValue('SETTLER_SMELTER', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
    settlerValue('SETTLER_TEMPLE_SERVANT', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
];

const VIKING_SETTLERS: SettlerValueInfo[] = [
    settlerValue('SETTLER_BEEKEEPER', 'FREE_WORKER_ROLE', ['SEARCH_BEEHIVE', 'SEARCH_BEEHIVE_SEED_POS']),
    settlerValue('SETTLER_MEADMAKER', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
];

const MAYA_SETTLERS: SettlerValueInfo[] = [
    settlerValue('SETTLER_AGAVEFARMER', 'FREE_WORKER_ROLE', ['SEARCH_AGAVE', 'SEARCH_AGAVE_SEED_POS']),
    settlerValue('SETTLER_TEQUILAMAKER', 'HOUSE_WORKER_ROLE', ['SEARCH_NO_SEARCH']),
];

function buildSettlerValueMap(settlers: SettlerValueInfo[]): RaceSettlerValueData {
    const map = new Map<string, SettlerValueInfo>();
    for (const s of settlers) map.set(s.id, s);
    return { settlers: map };
}

// ─────────────────────────────────────────────────────────────
// Minimal job definitions (jobInfo.xml stubs)
// ─────────────────────────────────────────────────────────────

/** Create a minimal JobNode stub with sensible defaults. */
function jobNode(task: string): JobNode {
    return {
        task,
        jobPart: '',
        x: 0,
        y: 0,
        duration: 100,
        dir: -1,
        forward: 1,
        visible: 1,
        useWork: false,
        entity: '',
        trigger: '',
    };
}

/**
 * Minimal job entries matching jobInfo.xml structure.
 * Only includes jobs referenced by settler animLists above.
 * First node task type determines how selectJob() classifies the job:
 *   - GO_TO_TARGET → entity-target job (harvest, woodcutting, stonecutting)
 *   - SEARCH → self-searching job (planting)
 */
const TEST_JOBS: JobInfo[] = [
    { id: 'JOB_WOODCUTTER_CHECKIN', nodes: [jobNode('GO_TO_POS')] },
    { id: 'JOB_WOODCUTTER_WORK', nodes: [jobNode('GO_TO_TARGET'), jobNode('WORK_ON_ENTITY')] },
    { id: 'JOB_STONECUTTER_CHECKIN', nodes: [jobNode('GO_TO_POS')] },
    { id: 'JOB_STONECUTTER_WORK', nodes: [jobNode('GO_TO_TARGET'), jobNode('WORK_ON_ENTITY')] },
    { id: 'JOB_FORESTER_CHECKIN', nodes: [jobNode('GO_TO_POS')] },
    { id: 'JOB_FORESTER_PLANT', nodes: [jobNode('SEARCH'), jobNode('GO_TO_POS')] },
    { id: 'JOB_FARMERGRAIN_CHECKIN', nodes: [jobNode('GO_TO_POS')] },
    { id: 'JOB_FARMERGRAIN_HARVEST', nodes: [jobNode('GO_TO_TARGET'), jobNode('WORK_ON_ENTITY')] },
    { id: 'JOB_FARMERGRAIN_PLANT', nodes: [jobNode('SEARCH'), jobNode('GO_TO_POS')] },
];

/** Build a race job map from the test job definitions. */
function buildRaceJobMap(): RaceJobData {
    const map = new Map<string, JobInfo>();
    for (const j of TEST_JOBS) map.set(j.id, j);
    return { jobs: map };
}

/**
 * Install minimal test game data into the GameDataLoader singleton.
 * Called automatically by createTestContext().
 */
export function installTestGameData(): void {
    clearWorkerBuildingCache();
    const raceBuildingMap = buildRaceBuildingMap();
    const races: RaceId[] = ['RACE_ROMAN', 'RACE_VIKING', 'RACE_MAYA', 'RACE_DARK', 'RACE_TROJAN'];

    const buildings = new Map();
    for (const raceId of races) {
        buildings.set(raceId, { buildings: raceBuildingMap });
    }

    const settlers = new Map<RaceId, RaceSettlerValueData>();
    settlers.set('RACE_ROMAN', buildSettlerValueMap(ROMAN_SETTLERS));
    settlers.set('RACE_VIKING', buildSettlerValueMap(VIKING_SETTLERS));
    settlers.set('RACE_MAYA', buildSettlerValueMap(MAYA_SETTLERS));

    const raceJobData = buildRaceJobMap();
    const jobs = new Map<RaceId, RaceJobData>();
    for (const raceId of races) {
        jobs.set(raceId, raceJobData);
    }

    const data: GameData = {
        buildings,
        jobs,
        objects: new Map(),
        buildingTriggers: new Map(),
        settlers,
    };

    const loader = GameDataLoader.getInstance();
    loader.setData(data);
}

/**
 * Attempt to load real XML game data from disk.
 * Returns true if real data was loaded, false if XML files are not present.
 * Use with describe.skipIf(!hasRealData) for tests that need real game data.
 */
export function installRealGameData(): boolean {
    // Check if the XML directory exists with core files
    const gameDataDir = resolve(process.cwd(), 'public/Siedler4/GameData');
    if (!existsSync(resolve(gameDataDir, 'buildingInfo.xml'))) return false;

    clearWorkerBuildingCache();
    const data = loadGameDataFromFiles(gameDataDir);
    GameDataLoader.getInstance().setData(data);
    return true;
}

/**
 * Reset the GameDataLoader singleton (for afterEach cleanup).
 */
export function resetTestGameData(): void {
    clearWorkerBuildingCache();
    GameDataLoader.resetInstance();
}

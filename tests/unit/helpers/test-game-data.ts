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
    BuildingPileInfo,
    RaceId,
    SettlerValueInfo,
    RaceSettlerValueData,
    JobInfo,
    JobNode,
    RaceJobData,
} from '@/resources/game-data/types';
import { PileSlotType } from '@/resources/game-data/types';
import { clearWorkerBuildingCache } from '@/game/game-data-access';
import { loadGameDataFromFiles } from '@/resources/game-data/load-game-data-from-files';
import { resetJobChoreographyStore } from '@/game/features/settler-tasks/job-choreography-store';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Generate a bitmask row with `width` contiguous bits starting at bit 31 (leftmost).
 * E.g. width=2 → bits 31,30 set → 0xC0000000 → -1073741824 (signed 32-bit)
 */
function bitmaskRow(width: number): number {
    let bits = 0;
    for (let i = 0; i < width; i++) bits |= 1 << (31 - i);
    return bits;
}

/** Minimal BuildingInfo with fields needed for worker resolution and construction costs. */
function buildingInfo(
    id: string,
    inhabitant: string,
    tool: string,
    size: 1 | 2 | 3 = 2,
    costs: { stone?: number; boards?: number; gold?: number } = {},
    piles: BuildingPileInfo[] = []
): BuildingInfo {
    const row = bitmaskRow(size);
    return {
        id,
        inhabitant,
        tool,
        hotSpotX: 0,
        hotSpotY: 0,
        stone: costs.stone ?? 0,
        boards: costs.boards ?? 0,
        gold: costs.gold ?? 0,
        lines: 0,
        buildingPosLines: Array.from({ length: size }, () => row),
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
        piles,
        builderInfos: [],
        dummyValue: 0,
        gridChangedForExport: 0,
        gridVersion: 0,
        helperFile: '',
        helperX: 0,
        helperY: 0,
    };
}

/** Create a minimal BuildingPileInfo for test pile slots. */
function pile(good: string, type: PileSlotType, xOffset: number, yOffset: number): BuildingPileInfo {
    return { good, type, xOffset, yOffset, xPixelOffset: 0, yPixelOffset: 0, patch: 0, appearance: 0 };
}

/**
 * Building definitions matching buildingInfo.xml.
 * Only includes buildings that have a non-empty inhabitant (worker buildings).
 */
const TEST_BUILDINGS: BuildingInfo[] = [
    buildingInfo('BUILDING_WOODCUTTERHUT', 'SETTLER_WOODCUTTER', 'GOOD_AXE', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_LOG', PileSlotType.Output, 3, 0),
    ]),
    buildingInfo('BUILDING_FORESTERHUT', 'SETTLER_FORESTER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }),
    buildingInfo('BUILDING_SAWMILL', 'SETTLER_SAWMILLWORKER', 'GOOD_SAW', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_LOG', PileSlotType.Input, 3, 1),
        pile('GOOD_BOARD', PileSlotType.Output, 3, 0),
    ]),
    buildingInfo('BUILDING_STONECUTTERHUT', 'SETTLER_STONECUTTER', 'GOOD_PICKAXE', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_STONE', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_GRAINFARM', 'SETTLER_FARMERGRAIN', 'GOOD_SCYTHE', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_GRAIN', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_MILL', 'SETTLER_MILLER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_GRAIN', PileSlotType.Input, 0, 0),
        pile('GOOD_FLOUR', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_BAKERY', 'SETTLER_BAKER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_FLOUR', PileSlotType.Input, 0, 0),
        pile('GOOD_WATER', PileSlotType.Input, 0, 0),
        pile('GOOD_BREAD', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_FISHERHUT', 'SETTLER_FISHER', 'GOOD_ROD', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_FISH', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_WATERWORKHUT', 'SETTLER_WATERWORKER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_WATER', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_HUNTERHUT', 'SETTLER_HUNTER', 'GOOD_BOW', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_MEAT', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_COALMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_FISH', PileSlotType.Input, 0, 0),
        pile('GOOD_MEAT', PileSlotType.Input, 0, 0),
        pile('GOOD_BREAD', PileSlotType.Input, 0, 0),
        pile('GOOD_COAL', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_IRONMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_MEAT', PileSlotType.Input, 0, 0),
        pile('GOOD_FISH', PileSlotType.Input, 0, 0),
        pile('GOOD_BREAD', PileSlotType.Input, 0, 0),
        pile('GOOD_IRONORE', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_GOLDMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_BREAD', PileSlotType.Input, 0, 0),
        pile('GOOD_FISH', PileSlotType.Input, 0, 0),
        pile('GOOD_MEAT', PileSlotType.Input, 0, 0),
        pile('GOOD_GOLDORE', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_SULFURMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_BREAD', PileSlotType.Input, 0, 0),
        pile('GOOD_FISH', PileSlotType.Input, 0, 0),
        pile('GOOD_MEAT', PileSlotType.Input, 0, 0),
        pile('GOOD_SULFUR', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_STONEMINE', 'SETTLER_MINEWORKER', 'GOOD_PICKAXE', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_FISH', PileSlotType.Input, 0, 0),
        pile('GOOD_BREAD', PileSlotType.Input, 0, 0),
        pile('GOOD_MEAT', PileSlotType.Input, 0, 0),
        pile('GOOD_STONE', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_SMELTIRON', 'SETTLER_SMELTER', 'GOOD_NO_GOOD', 2, { stone: 4, boards: 4 }, [
        pile('GOOD_COAL', PileSlotType.Input, 0, 0),
        pile('GOOD_IRONORE', PileSlotType.Input, 0, 0),
        pile('GOOD_IRONBAR', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_SMELTGOLD', 'SETTLER_SMELTER', 'GOOD_NO_GOOD', 2, { stone: 4, boards: 4 }, [
        pile('GOOD_COAL', PileSlotType.Input, 0, 0),
        pile('GOOD_GOLDORE', PileSlotType.Input, 0, 0),
        pile('GOOD_GOLDBAR', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_WEAPONSMITH', 'SETTLER_SMITH', 'GOOD_HAMMER', 2, { stone: 4, boards: 4 }, [
        pile('GOOD_COAL', PileSlotType.Input, 0, 0),
        pile('GOOD_IRONBAR', PileSlotType.Input, 0, 0),
        pile('GOOD_SWORD', PileSlotType.Output, 0, 0),
        pile('GOOD_BOW', PileSlotType.Output, 0, 0),
        pile('GOOD_ARMOR', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_TOOLSMITH', 'SETTLER_SMITH', 'GOOD_HAMMER', 2, { stone: 4, boards: 4 }, [
        pile('GOOD_IRONBAR', PileSlotType.Input, 0, 0),
        pile('GOOD_COAL', PileSlotType.Input, 0, 0),
        pile('GOOD_AXE', PileSlotType.Output, 0, 0),
        pile('GOOD_HAMMER', PileSlotType.Output, 0, 0),
        pile('GOOD_ROD', PileSlotType.Output, 0, 0),
        pile('GOOD_PICKAXE', PileSlotType.Output, 0, 0),
        pile('GOOD_SAW', PileSlotType.Output, 0, 0),
        pile('GOOD_SCYTHE', PileSlotType.Output, 0, 0),
        pile('GOOD_SHOVEL', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_AMMOMAKERHUT', 'SETTLER_AMMOMAKER', 'GOOD_PICKAXE', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_STONE', PileSlotType.Input, 0, 0),
        pile('GOOD_AMMO', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_HEALERHUT', 'SETTLER_HEALER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }),
    buildingInfo('BUILDING_DONKEYRANCH', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_WATER', PileSlotType.Input, 0, 0),
        pile('GOOD_GRAIN', PileSlotType.Input, 0, 0),
    ]),
    buildingInfo('BUILDING_VEHICLEHALL', 'SETTLER_VEHICLEMAKER', 'GOOD_HAMMER', 2, { stone: 4, boards: 6 }, [
        pile('GOOD_BOARD', PileSlotType.Input, 0, 0),
        pile('GOOD_IRONBAR', PileSlotType.Input, 0, 0),
    ]),
    buildingInfo('BUILDING_VINYARD', 'SETTLER_VINTNER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_WINE', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_AGAVEFARMERHUT', 'SETTLER_AGAVEFARMER', 'GOOD_SCYTHE', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_AGAVE', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_TEQUILAMAKERHUT', 'SETTLER_TEQUILAMAKER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_AGAVE', PileSlotType.Input, 0, 0),
        pile('GOOD_TEQUILA', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_BEEKEEPERHUT', 'SETTLER_BEEKEEPER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_HONEY', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_MEADMAKERHUT', 'SETTLER_MEADMAKER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 3 }, [
        pile('GOOD_HONEY', PileSlotType.Input, 0, 0),
        pile('GOOD_MEAD', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo('BUILDING_SUNFLOWERFARMERHUT', 'SETTLER_SUNFLOWERFARMER', 'GOOD_SCYTHE', 2, { stone: 2, boards: 2 }, [
        pile('GOOD_SUNFLOWER', PileSlotType.Output, 0, 0),
    ]),
    buildingInfo(
        'BUILDING_SUNFLOWEROILMAKERHUT',
        'SETTLER_SUNFLOWEROILMAKER',
        'GOOD_NO_GOOD',
        2,
        {
            stone: 3,
            boards: 3,
        },
        [pile('GOOD_SUNFLOWER', PileSlotType.Input, 0, 0), pile('GOOD_SUNFLOWEROIL', PileSlotType.Output, 0, 0)]
    ),
    buildingInfo('BUILDING_MUSHROOMFARM', 'SETTLER_MUSHROOMFARMER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }),
    // Military / residential buildings
    buildingInfo('BUILDING_STORAGEAREA', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 3, { stone: 4, boards: 6 }, [
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
        pile('GOOD_AGAVE', PileSlotType.Storage, 0, 0),
    ]),
    buildingInfo('BUILDING_RESIDENCESMALL', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }),
    buildingInfo('BUILDING_RESIDENCEMEDIUM', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 3 }),
    buildingInfo('BUILDING_RESIDENCEBIG', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 3, { stone: 5, boards: 5 }),
    buildingInfo('BUILDING_BARRACKS', '', 'GOOD_NO_GOOD', 2, { stone: 4, boards: 4 }, [
        pile('GOOD_GOLDBAR', PileSlotType.Input, 0, 0),
        pile('GOOD_SWORD', PileSlotType.Input, 0, 0),
        pile('GOOD_BOW', PileSlotType.Input, 0, 0),
        pile('GOOD_ARMOR', PileSlotType.Input, 0, 0),
    ]),
    buildingInfo('BUILDING_SMALLTEMPLE', 'SETTLER_TEMPLE_SERVANT', 'GOOD_NO_GOOD', 2, { stone: 6, boards: 4 }),
    buildingInfo('BUILDING_BIGTEMPLE', 'SETTLER_TEMPLE_SERVANT', 'GOOD_NO_GOOD', 3, { stone: 8, boards: 6 }),
    buildingInfo('BUILDING_CASTLE', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 3, { stone: 10, boards: 8, gold: 6 }),
    buildingInfo('BUILDING_GUARDTOWERSMALL', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 2, { stone: 3, boards: 2 }),
    buildingInfo('BUILDING_GUARDTOWERBIG', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 3, { stone: 5, boards: 4 }),
    buildingInfo('BUILDING_FORTRESS', 'SETTLER_CARRIER', 'GOOD_NO_GOOD', 3, { stone: 6, boards: 6 }),
    buildingInfo('BUILDING_LOOKOUTTOWER', '', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }),
    buildingInfo('BUILDING_DARKTEMPLE', 'SETTLER_TEMPLE_SERVANT', 'GOOD_NO_GOOD', 3, { stone: 8, boards: 6 }),
    buildingInfo('BUILDING_MANACOPTERHALL', 'SETTLER_MANACOPTERMASTER', 'GOOD_NO_GOOD', 3, { stone: 6, boards: 6 }),
    buildingInfo('BUILDING_SHIPYARDA', 'SETTLER_SHIPYARDWORKER', 'GOOD_HAMMER', 3, { stone: 4, boards: 6 }),
    // Eyecatchers (decorative monuments)
    buildingInfo('BUILDING_EYECATCHER01', '', 'GOOD_NO_GOOD', 1, { stone: 2 }),
    buildingInfo('BUILDING_EYECATCHER02', '', 'GOOD_NO_GOOD', 3, { stone: 4 }),
    buildingInfo('BUILDING_EYECATCHER03', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER04', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER05', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER06', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER07', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER08', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER09', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER10', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER11', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
    buildingInfo('BUILDING_EYECATCHER12', '', 'GOOD_NO_GOOD', 2, { stone: 3 }),
];

/** Animal good per race for AnimalRanch / Slaughterhouse. */
const RACE_ANIMAL_GOOD: Record<RaceId, string> = {
    RACE_ROMAN: 'GOOD_SHEEP',
    RACE_VIKING: 'GOOD_GOAT',
    RACE_MAYA: 'GOOD_PIG',
    RACE_TROJAN: 'GOOD_GOOSE',
    RACE_DARK: 'GOOD_SHEEP', // DarkTribe fallback
};

/** Build a race building map including race-specific AnimalRanch and Slaughterhouse. */
function buildRaceBuildingMap(raceId: RaceId): Map<string, BuildingInfo> {
    const map = new Map<string, BuildingInfo>();
    for (const b of TEST_BUILDINGS) {
        map.set(b.id, b);
    }
    const animalGood = RACE_ANIMAL_GOOD[raceId] ?? 'GOOD_SHEEP';
    map.set(
        'BUILDING_ANIMALRANCH',
        buildingInfo('BUILDING_ANIMALRANCH', 'SETTLER_FARMERANIMALS', 'GOOD_NO_GOOD', 2, { stone: 2, boards: 2 }, [
            pile('GOOD_WATER', PileSlotType.Input, 0, 0),
            pile('GOOD_GRAIN', PileSlotType.Input, 0, 0),
            pile(animalGood, PileSlotType.Output, 0, 0),
        ])
    );
    map.set(
        'BUILDING_SLAUGHTERHOUSE',
        buildingInfo('BUILDING_SLAUGHTERHOUSE', 'SETTLER_BUTCHER', 'GOOD_AXE', 2, { stone: 3, boards: 3 }, [
            pile(animalGood, PileSlotType.Input, 0, 0),
            pile('GOOD_MEAT', PileSlotType.Output, 0, 0),
        ])
    );
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
    const races: RaceId[] = ['RACE_ROMAN', 'RACE_VIKING', 'RACE_MAYA', 'RACE_DARK', 'RACE_TROJAN'];

    const buildings = new Map();
    for (const raceId of races) {
        buildings.set(raceId, { buildings: buildRaceBuildingMap(raceId) });
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
 * Cached parsed game data — XML files are read-only reference data that never
 * changes between tests, so we parse once and reuse.  This eliminates the
 * ~245 MB-per-cycle heap growth that previously caused OOM in long test files.
 */
let cachedRealGameData: GameData | null = null;

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
    if (!cachedRealGameData) {
        cachedRealGameData = loadGameDataFromFiles(gameDataDir);
    }
    GameDataLoader.getInstance().setData(cachedRealGameData);
    return true;
}

/**
 * Reset the GameDataLoader singleton (for afterEach cleanup).
 */
export function resetTestGameData(): void {
    clearWorkerBuildingCache();
    resetJobChoreographyStore();
    GameDataLoader.resetInstance();
}

/**
 * Test helper: injects minimal game data into the GameDataLoader singleton.
 *
 * Provides building info with inhabitant/tool fields matching the original XML
 * so that getBuildingWorkerInfo() works in unit tests without loading real XML files.
 */

import { GameDataLoader } from '@/resources/game-data/game-data-loader';
import type { GameData, BuildingInfo, RaceId } from '@/resources/game-data/types';
import { clearWorkerBuildingCache } from '@/game/game-data-access';

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
];

/** Build a race building map from the test building definitions. */
function buildRaceBuildingMap(): Map<string, BuildingInfo> {
    const map = new Map<string, BuildingInfo>();
    for (const b of TEST_BUILDINGS) {
        map.set(b.id, b);
    }
    return map;
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

    const data: GameData = {
        buildings,
        jobs: new Map(),
        objects: new Map(),
        buildingTriggers: new Map(),
    };

    const loader = GameDataLoader.getInstance();
    loader.setData(data);
}

/**
 * Reset the GameDataLoader singleton (for afterEach cleanup).
 */
export function resetTestGameData(): void {
    clearWorkerBuildingCache();
    GameDataLoader.resetInstance();
}

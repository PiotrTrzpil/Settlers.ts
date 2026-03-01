/**
 * Game Data Access — bridge between game domain types and the XML-keyed GameDataLoader.
 *
 * This is the ONLY module that translates between game enums (Race, BuildingType)
 * and XML string identifiers (RaceId, building XML IDs). All game code should use
 * this module for typed game data lookups instead of importing from '@/resources/game-data' directly.
 *
 * The game-data module in resources/ remains a pure data layer with no knowledge of game types.
 */

import { getGameDataLoader, type RaceId, type BuildingInfo, type ObjectInfo } from '@/resources/game-data';
import { S4SettlerType, S4GoodType } from '@/resources/map/s4-types';
import { Race } from './race';
import { BuildingType } from './buildings/building-type';
import { UnitType } from './unit-types';
import { EMaterialType } from './economy/material-type';
import { MapObjectType } from './types/map-object-types';
import { isBuildingAvailableForRace } from './race-availability';

// ============ Race translation ============

const RACE_TO_RACE_ID: Record<Race, RaceId> = {
    [Race.Roman]: 'RACE_ROMAN',
    [Race.Viking]: 'RACE_VIKING',
    [Race.Mayan]: 'RACE_MAYA',
    [Race.DarkTribe]: 'RACE_DARK',
    [Race.Trojan]: 'RACE_TROJAN',
};

const RACE_ID_TO_RACE: Record<RaceId, Race> = {
    RACE_ROMAN: Race.Roman,
    RACE_VIKING: Race.Viking,
    RACE_MAYA: Race.Mayan,
    RACE_DARK: Race.DarkTribe,
    RACE_TROJAN: Race.Trojan,
};

/** Convert a Race enum to the XML RaceId string. */
export function raceToRaceId(race: Race): RaceId {
    return RACE_TO_RACE_ID[race];
}

/** Convert an XML RaceId string to the Race enum. */
export function raceIdToRace(raceId: RaceId): Race {
    return RACE_ID_TO_RACE[raceId];
}

// ============ Building type translation ============

/**
 * BuildingType → XML building ID.
 * Some buildings have race-specific variants in XML (SHIPYARDA-H, PORTA-H)
 * but we use a single BuildingType for them.
 */
const BUILDING_TYPE_TO_XML_ID: Partial<Record<BuildingType, string>> = {
    [BuildingType.WoodcutterHut]: 'BUILDING_WOODCUTTERHUT',
    [BuildingType.StorageArea]: 'BUILDING_STORAGEAREA',
    [BuildingType.Sawmill]: 'BUILDING_SAWMILL',
    [BuildingType.StonecutterHut]: 'BUILDING_STONECUTTERHUT',
    [BuildingType.GrainFarm]: 'BUILDING_GRAINFARM',
    [BuildingType.Mill]: 'BUILDING_MILL',
    [BuildingType.Bakery]: 'BUILDING_BAKERY',
    [BuildingType.FisherHut]: 'BUILDING_FISHERHUT',
    [BuildingType.AnimalRanch]: 'BUILDING_ANIMALRANCH',
    [BuildingType.Slaughterhouse]: 'BUILDING_SLAUGHTERHOUSE',
    [BuildingType.WaterworkHut]: 'BUILDING_WATERWORKHUT',
    [BuildingType.CoalMine]: 'BUILDING_COALMINE',
    [BuildingType.IronMine]: 'BUILDING_IRONMINE',
    [BuildingType.GoldMine]: 'BUILDING_GOLDMINE',
    [BuildingType.IronSmelter]: 'BUILDING_SMELTIRON',
    [BuildingType.SmeltGold]: 'BUILDING_SMELTGOLD',
    [BuildingType.WeaponSmith]: 'BUILDING_WEAPONSMITH',
    [BuildingType.ToolSmith]: 'BUILDING_TOOLSMITH',
    [BuildingType.Barrack]: 'BUILDING_BARRACKS',
    [BuildingType.ForesterHut]: 'BUILDING_FORESTERHUT',
    [BuildingType.LivingHouse]: 'BUILDING_RESIDENCESMALL',
    [BuildingType.GuardTowerSmall]: 'BUILDING_GUARDTOWERSMALL',
    [BuildingType.HunterHut]: 'BUILDING_HUNTERHUT',
    [BuildingType.DonkeyRanch]: 'BUILDING_DONKEYRANCH',
    [BuildingType.StoneMine]: 'BUILDING_STONEMINE',
    [BuildingType.SulfurMine]: 'BUILDING_SULFURMINE',
    [BuildingType.HealerHut]: 'BUILDING_HEALERHUT',
    [BuildingType.ResidenceSmall]: 'BUILDING_RESIDENCESMALL',
    [BuildingType.ResidenceMedium]: 'BUILDING_RESIDENCEMEDIUM',
    [BuildingType.ResidenceBig]: 'BUILDING_RESIDENCEBIG',
    [BuildingType.GuardTowerBig]: 'BUILDING_GUARDTOWERBIG',
    [BuildingType.Castle]: 'BUILDING_CASTLE',
    [BuildingType.AmmunitionMaker]: 'BUILDING_AMMOMAKERHUT',
    [BuildingType.SmallTemple]: 'BUILDING_SMALLTEMPLE',
    [BuildingType.LargeTemple]: 'BUILDING_BIGTEMPLE',
    [BuildingType.LookoutTower]: 'BUILDING_LOOKOUTTOWER',
    [BuildingType.Shipyard]: 'BUILDING_SHIPYARDA',
    [BuildingType.Vinyard]: 'BUILDING_VINYARD',
    [BuildingType.AgaveFarmerHut]: 'BUILDING_AGAVEFARMERHUT',
    [BuildingType.TequilaMakerHut]: 'BUILDING_TEQUILAMAKERHUT',
    [BuildingType.BeekeeperHut]: 'BUILDING_BEEKEEPERHUT',
    [BuildingType.MeadMakerHut]: 'BUILDING_MEADMAKERHUT',
    [BuildingType.SunflowerFarmerHut]: 'BUILDING_SUNFLOWERFARMERHUT',
    [BuildingType.SunflowerOilMakerHut]: 'BUILDING_SUNFLOWEROILMAKERHUT',
    [BuildingType.SiegeWorkshop]: 'BUILDING_VEHICLEHALL',
    // Dark Tribe unique buildings
    [BuildingType.MushroomFarm]: 'BUILDING_MUSHROOMFARM',
    [BuildingType.DarkTemple]: 'BUILDING_DARKTEMPLE',
    [BuildingType.Fortress]: 'BUILDING_FORTRESS',
    [BuildingType.ManaCopterHall]: 'BUILDING_MANACOPTERHALL',
    // Eyecatchers (decorative monuments, 01-12)
    [BuildingType.Eyecatcher01]: 'BUILDING_EYECATCHER01',
    [BuildingType.Eyecatcher02]: 'BUILDING_EYECATCHER02',
    [BuildingType.Eyecatcher03]: 'BUILDING_EYECATCHER03',
    [BuildingType.Eyecatcher04]: 'BUILDING_EYECATCHER04',
    [BuildingType.Eyecatcher05]: 'BUILDING_EYECATCHER05',
    [BuildingType.Eyecatcher06]: 'BUILDING_EYECATCHER06',
    [BuildingType.Eyecatcher07]: 'BUILDING_EYECATCHER07',
    [BuildingType.Eyecatcher08]: 'BUILDING_EYECATCHER08',
    [BuildingType.Eyecatcher09]: 'BUILDING_EYECATCHER09',
    [BuildingType.Eyecatcher10]: 'BUILDING_EYECATCHER10',
    [BuildingType.Eyecatcher11]: 'BUILDING_EYECATCHER11',
    [BuildingType.Eyecatcher12]: 'BUILDING_EYECATCHER12',
};

/** Reverse map: XML building ID → BuildingType(s). Lazy-initialized. */
let xmlIdToBuildingTypeMap: Map<string, BuildingType[]> | null = null;

function ensureXmlIdMap(): Map<string, BuildingType[]> {
    if (!xmlIdToBuildingTypeMap) {
        xmlIdToBuildingTypeMap = new Map();
        for (const [btStr, xmlId] of Object.entries(BUILDING_TYPE_TO_XML_ID)) {
            const bt = Number(btStr) as BuildingType;
            const arr = xmlIdToBuildingTypeMap.get(xmlId);
            if (arr) arr.push(bt);
            else xmlIdToBuildingTypeMap.set(xmlId, [bt]);
        }
    }
    return xmlIdToBuildingTypeMap;
}

/** Resolve XML building ID → BuildingType(s). Used by settler-data-access for building-sourced jobs. */
export function xmlIdToBuildingTypes(xmlId: string): BuildingType[] {
    return ensureXmlIdMap().get(xmlId) ?? [];
}

// ============ Typed game data lookups ============

/**
 * Look up BuildingInfo from game data by domain types.
 * Throws if game data is not yet loaded or the building type has no XML ID mapping.
 * Returns undefined if the XML entry is absent for this race (e.g. decorative eyecatchers).
 */
export function getBuildingInfo(race: Race, buildingType: BuildingType): BuildingInfo | undefined {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) throw new Error('getBuildingInfo called before game data is loaded');
    const xmlId = BUILDING_TYPE_TO_XML_ID[buildingType];
    if (!xmlId) throw new Error(`No XML mapping for BuildingType ${BuildingType[buildingType]}`);
    return loader.getBuilding(RACE_TO_RACE_ID[race], xmlId) ?? undefined;
}

/**
 * Get the door tile offset for a building type + race from XML data.
 * Returns the tile offset settlers should walk to when entering the building.
 * Returns null if the building has a zero door offset (building anchor is the door).
 * Throws if game data is not yet loaded or the building type has no XML mapping.
 */
export function getBuildingDoorOffset(race: Race, buildingType: BuildingType): { dx: number; dy: number } | null {
    const info = getBuildingInfo(race, buildingType);
    if (!info) throw new Error(`No BuildingInfo found for ${BuildingType[buildingType]} / race ${Race[race]}`);
    const { xOffset, yOffset } = info.door;
    if (xOffset === 0 && yOffset === 0) return null;
    return { dx: xOffset, dy: yOffset };
}

/**
 * Get the absolute door tile position for a building.
 * Combines building position with door offset. When the offset is zero,
 * the building anchor itself is the door.
 */
export function getBuildingDoorPos(
    bx: number,
    by: number,
    race: Race,
    buildingType: BuildingType
): { x: number; y: number } {
    const door = getBuildingDoorOffset(race, buildingType);
    return door ? { x: bx + door.dx, y: by + door.dy } : { x: bx, y: by };
}

/**
 * Get BuildingType(s) for an XML building ID.
 * Used when iterating raw game data (e.g., overlay registration at init).
 */
export function getBuildingTypesByXmlId(xmlId: string): readonly BuildingType[] | undefined {
    return ensureXmlIdMap().get(xmlId);
}

// ============ S4 type mappings ============
// Shared translation tables from S4 binary types to game domain types.
// Used by map loaders (settlers, stacks) and XML data lookups.

/**
 * S4SettlerType → internal UnitType.
 * Only includes types that are implemented in the engine.
 */
export const S4_TO_UNIT_TYPE: Partial<Record<S4SettlerType, UnitType>> = {
    [S4SettlerType.CARRIER]: UnitType.Carrier,
    [S4SettlerType.BUILDER]: UnitType.Builder,
    [S4SettlerType.WOODCUTTER]: UnitType.Woodcutter,
    [S4SettlerType.STONECUTTER]: UnitType.Stonecutter,
    [S4SettlerType.FORESTER]: UnitType.Forester,
    [S4SettlerType.SWORDSMAN_01]: UnitType.Swordsman,
    [S4SettlerType.SWORDSMAN_02]: UnitType.Swordsman2,
    [S4SettlerType.SWORDSMAN_03]: UnitType.Swordsman3,
    [S4SettlerType.BOWMAN_01]: UnitType.Bowman,
    [S4SettlerType.BOWMAN_02]: UnitType.Bowman2,
    [S4SettlerType.BOWMAN_03]: UnitType.Bowman3,
    [S4SettlerType.PRIEST]: UnitType.Priest,
    [S4SettlerType.PIONEER]: UnitType.Pioneer,
    [S4SettlerType.THIEF]: UnitType.Thief,
    [S4SettlerType.GEOLOGIST]: UnitType.Geologist,
    [S4SettlerType.SMITH]: UnitType.Smith,
    [S4SettlerType.SQUADLEADER]: UnitType.SquadLeader,
    [S4SettlerType.DARKGARDENER]: UnitType.DarkGardener,
    [S4SettlerType.SHAMAN]: UnitType.Shaman,
    [S4SettlerType.MEDIC_01]: UnitType.Medic,
    [S4SettlerType.MEDIC_02]: UnitType.Medic2,
    [S4SettlerType.MEDIC_03]: UnitType.Medic3,
    [S4SettlerType.MINEWORKER]: UnitType.Miner,
    [S4SettlerType.SMELTER]: UnitType.Smelter,
    [S4SettlerType.HUNTER]: UnitType.Hunter,
    [S4SettlerType.HEALER]: UnitType.Healer,
    [S4SettlerType.DONKEY]: UnitType.Donkey,
    [S4SettlerType.SAWMILLWORKER]: UnitType.SawmillWorker,
    [S4SettlerType.FARMERGRAIN]: UnitType.Farmer,
    [S4SettlerType.AGAVEFARMER]: UnitType.AgaveFarmer,
    [S4SettlerType.BEEKEEPER]: UnitType.Beekeeper,
    [S4SettlerType.MUSHROOMFARMER]: UnitType.MushroomFarmer,
    [S4SettlerType.ANGEL_01]: UnitType.Angel,
    [S4SettlerType.ANGEL_02]: UnitType.Angel2,
    [S4SettlerType.ANGEL_03]: UnitType.Angel3,
    [S4SettlerType.MILLER]: UnitType.Miller,
    [S4SettlerType.BUTCHER]: UnitType.Butcher,
    [S4SettlerType.FISHER]: UnitType.Hunter, // Fisher uses Hunter unit type
    [S4SettlerType.BAKER]: UnitType.Baker,
    [S4SettlerType.FARMERANIMALS]: UnitType.AnimalFarmer,
    [S4SettlerType.WATERWORKER]: UnitType.Waterworker,
    [S4SettlerType.CHARCOALMAKER]: UnitType.Smith, // Charcoal maker uses Smith unit type
    [S4SettlerType.AMMOMAKER]: UnitType.Smith, // Ammo maker uses Smith unit type
    [S4SettlerType.VEHICLEMAKER]: UnitType.Smith, // Vehicle maker uses Smith unit type
    [S4SettlerType.VINTNER]: UnitType.Winemaker,
    [S4SettlerType.MEADMAKER]: UnitType.Meadmaker,
    [S4SettlerType.TEQUILAMAKER]: UnitType.Tequilamaker,
    [S4SettlerType.SUNFLOWERFARMER]: UnitType.SunflowerFarmer,
    [S4SettlerType.SUNFLOWEROILMAKER]: UnitType.Smith, // Oil maker uses Smith unit type
    [S4SettlerType.SHIPYARDWORKER]: UnitType.Smith, // Shipyard worker uses Smith unit type
    [S4SettlerType.TEMPLE_SERVANT]: UnitType.TempleServant,
    [S4SettlerType.AXEWARRIOR_01]: UnitType.AxeWarrior,
    [S4SettlerType.AXEWARRIOR_02]: UnitType.AxeWarrior2,
    [S4SettlerType.AXEWARRIOR_03]: UnitType.AxeWarrior3,
    [S4SettlerType.BLOWGUNWARRIOR_01]: UnitType.BlowgunWarrior,
    [S4SettlerType.BLOWGUNWARRIOR_02]: UnitType.BlowgunWarrior2,
    [S4SettlerType.BLOWGUNWARRIOR_03]: UnitType.BlowgunWarrior3,
    [S4SettlerType.BACKPACKCATAPULTIST_01]: UnitType.BackpackCatapultist,
    [S4SettlerType.BACKPACKCATAPULTIST_02]: UnitType.BackpackCatapultist2,
    [S4SettlerType.BACKPACKCATAPULTIST_03]: UnitType.BackpackCatapultist3,
    [S4SettlerType.SABOTEUR]: UnitType.Saboteur,
    [S4SettlerType.SLAVED_SETTLER]: UnitType.SlavedSettler,
    [S4SettlerType.MANACOPTERMASTER]: UnitType.ManacopterMaster,
};

/**
 * S4GoodType → internal EMaterialType.
 * Only includes types that are implemented in the engine.
 */
export const S4_TO_MATERIAL_TYPE: Partial<Record<S4GoodType, EMaterialType>> = {
    [S4GoodType.LOG]: EMaterialType.LOG,
    [S4GoodType.STONE]: EMaterialType.STONE,
    [S4GoodType.COAL]: EMaterialType.COAL,
    [S4GoodType.IRONORE]: EMaterialType.IRONORE,
    [S4GoodType.GOLDORE]: EMaterialType.GOLDORE,
    [S4GoodType.GRAIN]: EMaterialType.GRAIN,
    [S4GoodType.PIG]: EMaterialType.PIG,
    [S4GoodType.WATER]: EMaterialType.WATER,
    [S4GoodType.FISH]: EMaterialType.FISH,
    [S4GoodType.BOARD]: EMaterialType.BOARD,
    [S4GoodType.IRONBAR]: EMaterialType.IRONBAR,
    [S4GoodType.GOLDBAR]: EMaterialType.GOLDBAR,
    [S4GoodType.FLOUR]: EMaterialType.FLOUR,
    [S4GoodType.BREAD]: EMaterialType.BREAD,
    [S4GoodType.MEAT]: EMaterialType.MEAT,
    [S4GoodType.WINE]: EMaterialType.WINE,
    [S4GoodType.AXE]: EMaterialType.AXE,
    [S4GoodType.PICKAXE]: EMaterialType.PICKAXE,
    [S4GoodType.SAW]: EMaterialType.SAW,
    [S4GoodType.HAMMER]: EMaterialType.HAMMER,
    [S4GoodType.SCYTHE]: EMaterialType.SCYTHE,
    [S4GoodType.ROD]: EMaterialType.ROD,
    [S4GoodType.SWORD]: EMaterialType.SWORD,
    [S4GoodType.BOW]: EMaterialType.BOW,
    [S4GoodType.SULFUR]: EMaterialType.SULFUR,
    [S4GoodType.ARMOR]: EMaterialType.ARMOR,
    [S4GoodType.BATTLEAXE]: EMaterialType.BATTLEAXE,
    [S4GoodType.AGAVE]: EMaterialType.AGAVE,
    [S4GoodType.BLOWGUN]: EMaterialType.BLOWGUN,
    [S4GoodType.GOAT]: EMaterialType.GOAT,
    [S4GoodType.MEAD]: EMaterialType.MEAD,
    [S4GoodType.HONEY]: EMaterialType.HONEY,
    [S4GoodType.SHEEP]: EMaterialType.SHEEP,
    [S4GoodType.SHOVEL]: EMaterialType.SHOVEL,
    [S4GoodType.BACKPACKCATAPULT]: EMaterialType.CATAPULT,
    [S4GoodType.GOOSE]: EMaterialType.GOOSE,
    [S4GoodType.TEQUILA]: EMaterialType.TEQUILA,
    [S4GoodType.SUNFLOWER]: EMaterialType.SUNFLOWER,
    [S4GoodType.SUNFLOWEROIL]: EMaterialType.SUNFLOWEROIL,
};

// ============ XML string → domain type helpers ============

/** Convert XML settler string (e.g. "SETTLER_WOODCUTTER") to UnitType. */
function xmlSettlerToUnitType(xmlSettler: string): UnitType | undefined {
    if (!xmlSettler) return undefined;
    const name = xmlSettler.replace('SETTLER_', '');
    if (!(name in S4SettlerType)) return undefined;
    return S4_TO_UNIT_TYPE[S4SettlerType[name as keyof typeof S4SettlerType]];
}

/** Convert XML good string (e.g. "GOOD_PICKAXE") to EMaterialType. */
export function xmlGoodToMaterialType(xmlGood: string): EMaterialType | undefined {
    if (!xmlGood || xmlGood === 'GOOD_NO_GOOD') return undefined;
    const name = xmlGood.replace('GOOD_', '');
    if (!(name in S4GoodType)) return undefined;
    return S4_TO_MATERIAL_TYPE[S4GoodType[name as keyof typeof S4GoodType]];
}

// ============ Building worker info (from XML) ============

export interface BuildingWorkerInfo {
    /** The unit type that works in this building (derived from XML inhabitant field) */
    unitType: UnitType;
    /** The tool/good required before the worker can start (derived from XML tool field) */
    tool: EMaterialType | undefined;
}

/**
 * Get the worker UnitType and required tool for a building, derived from buildingInfo.xml.
 * Returns undefined if data not loaded, no XML mapping exists, building has no XML entry for
 * this race (e.g. decorative eyecatchers), or building has no worker inhabitant.
 */
export function getBuildingWorkerInfo(race: Race, buildingType: BuildingType): BuildingWorkerInfo | undefined {
    const info = getBuildingInfo(race, buildingType);
    if (!info?.inhabitant) return undefined;

    const unitType = xmlSettlerToUnitType(info.inhabitant);
    if (unitType === undefined) return undefined;

    const tool = xmlGoodToMaterialType(info.tool);
    return { unitType, tool };
}

/**
 * Get all building types where a worker unit type can work, derived from XML.
 * This is the reverse lookup of getBuildingWorkerInfo: given a UnitType, find matching buildings.
 * Returns undefined if unit type has no workplace or if game data is not yet loaded.
 */
export function getWorkerBuildingTypes(race: Race, unitType: UnitType): ReadonlySet<BuildingType> | undefined {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) return undefined;

    let raceMap = workerBuildingCache.get(race);
    if (!raceMap) {
        raceMap = new Map<UnitType, Set<BuildingType>>();
        for (const btStr of Object.keys(BUILDING_TYPE_TO_XML_ID)) {
            const bt = Number(btStr) as BuildingType;
            if (!isBuildingAvailableForRace(bt, race)) continue;
            const workerInfo = getBuildingWorkerInfo(race, bt);
            if (workerInfo) {
                let set = raceMap.get(workerInfo.unitType);
                if (!set) {
                    set = new Set();
                    raceMap.set(workerInfo.unitType, set);
                }
                set.add(bt);
            }
        }
        workerBuildingCache.set(race, raceMap);
    }
    return raceMap.get(unitType);
}

/** Cached reverse map: race → (unitType → Set<BuildingType>). Built lazily from XML data. */
const workerBuildingCache = new Map<Race, Map<UnitType, Set<BuildingType>>>();

/** Clear cached worker-building lookups (call when game data changes, e.g. in tests). */
export function clearWorkerBuildingCache(): void {
    workerBuildingCache.clear();
}

// ============ Map object type translation ============

/**
 * MapObjectType → XML object ID from objectInfo.xml.
 *
 * NOTE: Tree→TREE## mapping is assumed (TREE01=Oak, TREE02=Beech, ...) and needs
 * verification against actual sprite data. "A" variant is used as primary.
 */
const MAP_OBJECT_TYPE_TO_XML_ID: Partial<Record<MapObjectType, string>> = {
    // ---- Trees — assumed 1:1 with TREE## numbering (TODO: verify) ----
    [MapObjectType.TreeOak]: 'OBJECT_TREE01A',
    [MapObjectType.TreeBeech]: 'OBJECT_TREE02A',
    [MapObjectType.TreeAsh]: 'OBJECT_TREE03A',
    [MapObjectType.TreeLinden]: 'OBJECT_TREE04A',
    [MapObjectType.TreeBirch]: 'OBJECT_TREE05A',
    [MapObjectType.TreePoplar]: 'OBJECT_TREE06A',
    [MapObjectType.TreeChestnut]: 'OBJECT_TREE07A',
    [MapObjectType.TreeMaple]: 'OBJECT_TREE07B',
    [MapObjectType.TreeFir]: 'OBJECT_TREE08A',
    [MapObjectType.TreeSpruce]: 'OBJECT_TREE08B',
    [MapObjectType.TreeCoconut]: 'OBJECT_TREE09A',
    [MapObjectType.TreeDate]: 'OBJECT_TREE09B',
    [MapObjectType.TreeWalnut]: 'OBJECT_TREE10A',
    [MapObjectType.TreeCorkOak]: 'OBJECT_TREE10B',
    [MapObjectType.TreePine]: 'OBJECT_TREE11A',
    [MapObjectType.TreePine2]: 'OBJECT_TREE11B',
    [MapObjectType.TreeOliveLarge]: 'OBJECT_TREE06B', // TODO: verify — olives might be separate
    [MapObjectType.TreeOliveSmall]: 'OBJECT_TREE05B', // TODO: verify

    // ---- Dark Tribe trees ----
    [MapObjectType.DarkTree1A]: 'OBJECT_DARKTREE01A',
    [MapObjectType.DarkTree1B]: 'OBJECT_DARKTREE01B',
    [MapObjectType.DarkTree2A]: 'OBJECT_DARKTREE02A',
    [MapObjectType.DarkTree2B]: 'OBJECT_DARKTREE02B',
    [MapObjectType.DarkTree3A]: 'OBJECT_DARKTREE03A',
    [MapObjectType.DarkTree3B]: 'OBJECT_DARKTREE03B',
    [MapObjectType.DarkTree4A]: 'OBJECT_DARKTREE04A',
    [MapObjectType.DarkTree5A]: 'OBJECT_DARKTREE05A',

    // ---- Resources ----
    [MapObjectType.ResourceStone]: 'OBJECT_STONEMINE1_00',
    [MapObjectType.ResourceDarkStone]: 'OBJECT_DARKSTONEMINE1_00',
    [MapObjectType.ResourceStone2]: 'OBJECT_STONEMINE2_00',

    // ---- Crops ----
    [MapObjectType.Grain]: 'OBJECT_WHEAT1',
    [MapObjectType.Sunflower]: 'OBJECT_SUNFLOWER',
    [MapObjectType.Agave]: 'OBJECT_AGAVE',
    [MapObjectType.Beehive]: 'OBJECT_HIVE',
    [MapObjectType.Grape]: 'OBJECT_GRAPE',
    [MapObjectType.Wheat2]: 'OBJECT_WHEAT2',

    // ---- Bushes ----
    [MapObjectType.Bush1]: 'OBJECT_BUSH1',
    [MapObjectType.Bush2]: 'OBJECT_BUSH2',
    [MapObjectType.Bush3]: 'OBJECT_BUSH3',
    [MapObjectType.Bush4]: 'OBJECT_BUSH4',
    [MapObjectType.Bush5]: 'OBJECT_BUSH5',
    [MapObjectType.Bush6]: 'OBJECT_BUSH6',
    [MapObjectType.Bush7]: 'OBJECT_BUSH7',
    [MapObjectType.Bush8]: 'OBJECT_BUSH8',
    [MapObjectType.Bush9]: 'OBJECT_BUSH9',
    [MapObjectType.DarkBush1]: 'OBJECT_DARKBUSH1',
    [MapObjectType.DarkBush2]: 'OBJECT_DARKBUSH2',
    [MapObjectType.DarkBush3]: 'OBJECT_DARKBUSH3',
    [MapObjectType.DarkBush4]: 'OBJECT_DARKBUSH4',
    [MapObjectType.DesertBush1]: 'OBJECT_DESERTBUSH1',
    [MapObjectType.DesertBush2]: 'OBJECT_DESERTBUSH2',
    [MapObjectType.DesertBush3]: 'OBJECT_DESERTBUSH3',

    // ---- Ground cover — Flowers ----
    [MapObjectType.Flower1]: 'OBJECT_FLOWER1',
    [MapObjectType.Flower2]: 'OBJECT_FLOWER2',
    [MapObjectType.Flower3]: 'OBJECT_FLOWER3',
    [MapObjectType.Flower4]: 'OBJECT_FLOWER4',
    [MapObjectType.Flower5]: 'OBJECT_FLOWER5',
    [MapObjectType.SpecialFlower]: 'OBJECT_SPECIAL_FLOWER',

    // ---- Ground cover — Grass ----
    [MapObjectType.Grass1]: 'OBJECT_GRASS1',
    [MapObjectType.Grass2]: 'OBJECT_GRASS2',
    [MapObjectType.Grass3]: 'OBJECT_GRASS3',
    [MapObjectType.Grass4]: 'OBJECT_GRASS4',
    [MapObjectType.Grass5]: 'OBJECT_GRASS5',
    [MapObjectType.Grass6]: 'OBJECT_GRASS6',
    [MapObjectType.Grass7]: 'OBJECT_GRASS7',
    [MapObjectType.Grass8]: 'OBJECT_GRASS8',
    [MapObjectType.Grass9]: 'OBJECT_GRASS9',
    [MapObjectType.Grass10]: 'OBJECT_GRASS10',

    // ---- Ground cover — Foliage & Branches ----
    [MapObjectType.Foliage1]: 'OBJECT_FOLIAGE1',
    [MapObjectType.Foliage2]: 'OBJECT_FOLIAGE2',
    [MapObjectType.Foliage3]: 'OBJECT_FOLIAGE3',
    [MapObjectType.Branch1]: 'OBJECT_BRANCH1',
    [MapObjectType.Branch2]: 'OBJECT_BRANCH2',
    [MapObjectType.Branch3]: 'OBJECT_BRANCH3',
    [MapObjectType.Branch4]: 'OBJECT_BRANCH4',

    // ---- Desert plants ----
    [MapObjectType.Cactus1]: 'OBJECT_CACTUS1',
    [MapObjectType.Cactus2]: 'OBJECT_CACTUS2',
    [MapObjectType.Cactus3]: 'OBJECT_CACTUS3',
    [MapObjectType.Cactus4]: 'OBJECT_CACTUS4',

    // ---- Water vegetation ----
    [MapObjectType.Reed1]: 'OBJECT_REED1',
    [MapObjectType.Reed2]: 'OBJECT_REED2',
    [MapObjectType.Reed3]: 'OBJECT_REED3',
    [MapObjectType.Seaweed1]: 'OBJECT_SEEWEED1', // Note: XML spells it "SEEWEED"
    [MapObjectType.Seaweed2]: 'OBJECT_SEEWEED2',
    [MapObjectType.Seaweed3]: 'OBJECT_SEEWEED3',
    [MapObjectType.WaterLily1]: 'OBJECT_WATERLILY1',
    [MapObjectType.WaterLily2]: 'OBJECT_WATERLILY2',
    [MapObjectType.WaterLily3]: 'OBJECT_WATERLILY3',

    // ---- Mushrooms ----
    [MapObjectType.Mushroom1]: 'OBJECT_MUSHROOM1',
    [MapObjectType.Mushroom2]: 'OBJECT_MUSHROOM2',
    [MapObjectType.Mushroom3]: 'OBJECT_MUSHROOM3',
    [MapObjectType.MushroomDark1]: 'OBJECT_MUSHROOM_DARK1',
    [MapObjectType.MushroomDark2]: 'OBJECT_MUSHROOM_DARK2',
    [MapObjectType.MushroomDark3]: 'OBJECT_MUSHROOM_DARK3',
    [MapObjectType.EvilMushroom1]: 'OBJECT_EVILMUSHROOM1',
    [MapObjectType.EvilMushroom2]: 'OBJECT_EVILMUSHROOM2',
    [MapObjectType.EvilMushroom3]: 'OBJECT_EVILMUSHROOM3',
    [MapObjectType.MushroomCycle]: 'OBJECT_MUSHROOMCYCLE',

    // ---- Decorative stones — Brownish ----
    [MapObjectType.StoneBrownish1]: 'OBJECT_STONEBROWNISH1',
    [MapObjectType.StoneBrownish2]: 'OBJECT_STONEBROWNISH2',
    [MapObjectType.StoneBrownish3]: 'OBJECT_STONEBROWNISH3',
    [MapObjectType.StoneBrownish4]: 'OBJECT_STONEBROWNISH4',
    [MapObjectType.StoneBrownish5]: 'OBJECT_STONEBROWNISH5',
    [MapObjectType.StoneBrownish6]: 'OBJECT_STONEBROWNISH6',
    [MapObjectType.StoneBrownish7]: 'OBJECT_STONEBROWNISH7',
    [MapObjectType.StoneBrownish8]: 'OBJECT_STONEBROWNISH8',
    [MapObjectType.StoneBrownish9]: 'OBJECT_STONEBROWNISH9',
    [MapObjectType.StoneBrownish10]: 'OBJECT_STONEBROWNISH10',

    // ---- Decorative stones — Darkish ----
    [MapObjectType.StoneDarkish1]: 'OBJECT_STONEDARKISH1',
    [MapObjectType.StoneDarkish2]: 'OBJECT_STONEDARKISH2',
    [MapObjectType.StoneDarkish3]: 'OBJECT_STONEDARKISH3',
    [MapObjectType.StoneDarkish4]: 'OBJECT_STONEDARKISH4',
    [MapObjectType.StoneDarkish5]: 'OBJECT_STONEDARKISH5',
    [MapObjectType.StoneDarkish6]: 'OBJECT_STONEDARKISH6',
    [MapObjectType.StoneDarkish7]: 'OBJECT_STONEDARKISH7',
    [MapObjectType.StoneDarkish8]: 'OBJECT_STONEDARKISH8',
    [MapObjectType.StoneDarkish9]: 'OBJECT_STONEDARKISH9',
    [MapObjectType.StoneDarkish10]: 'OBJECT_STONEDARKISH10',

    // ---- Decorative stones — Darkish B ----
    [MapObjectType.StoneDarkishB1]: 'OBJECT_STONEDARKISH_B01',
    [MapObjectType.StoneDarkishB2]: 'OBJECT_STONEDARKISH_B02',
    [MapObjectType.StoneDarkishB3]: 'OBJECT_STONEDARKISH_B03',
    [MapObjectType.StoneDarkishB4]: 'OBJECT_STONEDARKISH_B04',
    [MapObjectType.StoneDarkishB5]: 'OBJECT_STONEDARKISH_B05',
    [MapObjectType.StoneDarkishB6]: 'OBJECT_STONEDARKISH_B06',
    [MapObjectType.StoneDarkishB7]: 'OBJECT_STONEDARKISH_B07',
    [MapObjectType.StoneDarkishB8]: 'OBJECT_STONEDARKISH_B08',
    [MapObjectType.StoneDarkishB9]: 'OBJECT_STONEDARKISH_B09',
    [MapObjectType.StoneDarkishB10]: 'OBJECT_STONEDARKISH_B10',

    // ---- Decorative stones — Darkish G ----
    [MapObjectType.StoneDarkishG1]: 'OBJECT_STONEDARKISH_G01',
    [MapObjectType.StoneDarkishG2]: 'OBJECT_STONEDARKISH_G02',
    [MapObjectType.StoneDarkishG3]: 'OBJECT_STONEDARKISH_G03',
    [MapObjectType.StoneDarkishG4]: 'OBJECT_STONEDARKISH_G04',
    [MapObjectType.StoneDarkishG5]: 'OBJECT_STONEDARKISH_G05',
    [MapObjectType.StoneDarkishG6]: 'OBJECT_STONEDARKISH_G06',
    [MapObjectType.StoneDarkishG7]: 'OBJECT_STONEDARKISH_G07',
    [MapObjectType.StoneDarkishG8]: 'OBJECT_STONEDARKISH_G08',
    [MapObjectType.StoneDarkishG9]: 'OBJECT_STONEDARKISH_G09',
    [MapObjectType.StoneDarkishG10]: 'OBJECT_STONEDARKISH_G10',

    // ---- Decorative stones — Greyish ----
    [MapObjectType.StoneGreyish1]: 'OBJECT_STONEGREYISH1',
    [MapObjectType.StoneGreyish2]: 'OBJECT_STONEGREYISH2',
    [MapObjectType.StoneGreyish3]: 'OBJECT_STONEGREYISH3',
    [MapObjectType.StoneGreyish4]: 'OBJECT_STONEGREYISH4',
    [MapObjectType.StoneGreyish5]: 'OBJECT_STONEGREYISH5',
    [MapObjectType.StoneGreyish6]: 'OBJECT_STONEGREYISH6',
    [MapObjectType.StoneGreyish7]: 'OBJECT_STONEGREYISH7',
    [MapObjectType.StoneGreyish8]: 'OBJECT_STONEGREYISH8',
    [MapObjectType.StoneGreyish9]: 'OBJECT_STONEGREYISH9',
    [MapObjectType.StoneGreyish10]: 'OBJECT_STONEGREYISH10',

    // ---- Water features ----
    [MapObjectType.Pond]: 'OBJECT_POND',
    [MapObjectType.DarkPond]: 'OBJECT_DARKPOND',

    // ---- Waves ----
    [MapObjectType.Wave]: 'OBJECT_WAVE96X63',
    [MapObjectType.WaveLake1]: 'OBJECT_WAVE_LAKE24X12',
    [MapObjectType.WaveLake2]: 'OBJECT_WAVE_LAKE28X22',
    [MapObjectType.WaveLake3]: 'OBJECT_WAVE_LAKE37X19',
    [MapObjectType.WaveLake4]: 'OBJECT_WAVE_LAKE40X24',
    [MapObjectType.WaveLake5]: 'OBJECT_WAVE_LAKE48X19',
    [MapObjectType.WaveLake6]: 'OBJECT_WAVE_LAKE49X18',
    [MapObjectType.WaveLake7]: 'OBJECT_WAVE_LAKE51X29',

    // ---- Misc objects ----
    [MapObjectType.Well]: 'OBJECT_WELL',
    [MapObjectType.Scarecrow]: 'OBJECT_SCARECROW',
    [MapObjectType.Snowman]: 'OBJECT_SNOWMAN',
    [MapObjectType.DarkSnowman]: 'OBJECT_DARKSNOWMAN',
    [MapObjectType.Flag]: 'OBJECT_FLAG',
    [MapObjectType.Grave1]: 'OBJECT_GRAVE1',
    [MapObjectType.Grave2]: 'OBJECT_GRAVE2',
    [MapObjectType.RuneStone]: 'OBJECT_RUNESTONE',
    [MapObjectType.CelticCross]: 'OBJECT_CELTICCROSS',
    [MapObjectType.PalmPlant]: 'OBJECT_PALMPLANT',
    [MapObjectType.ShadowHerb]: 'OBJECT_SHADOWHERB',
    [MapObjectType.Wreck]: 'OBJECT_WRECK1',
    [MapObjectType.DarkRope]: 'OBJECT_DARKROPE1',
    [MapObjectType.DarkSpitter]: 'OBJECT_DARKSPITTER',
    [MapObjectType.Boundary]: 'OBJECT_BOUNDARY',
    [MapObjectType.BaseMorbus]: 'OBJECT_BASE_MORBUS',
    [MapObjectType.WaggonDestroyed]: 'OBJECT_WAGGONDESTR',
    [MapObjectType.Reeve1]: 'OBJECT_REEVE1',
    [MapObjectType.Reeve2]: 'OBJECT_REEVE2',
    [MapObjectType.Reeve3]: 'OBJECT_REEVE3',
    [MapObjectType.Reeve4]: 'OBJECT_REEVE4',
    [MapObjectType.SkeletonDesert1]: 'OBJECT_SKELETONDESERT1',
    [MapObjectType.SkeletonDesert2]: 'OBJECT_SKELETONDESERT2',
    [MapObjectType.Mussel1]: 'OBJECT_MUSSEL1',
    [MapObjectType.Mussel2]: 'OBJECT_MUSSEL2',

    // ---- Resource indicators ----
    [MapObjectType.ResCoal]: 'OBJECT_RESCOAL',
    [MapObjectType.ResFish]: 'OBJECT_RESFISH',
    [MapObjectType.ResGold]: 'OBJECT_RESGOLD',
    [MapObjectType.ResIron]: 'OBJECT_RESIRON',
    [MapObjectType.ResStone]: 'OBJECT_RESSTONE',
    [MapObjectType.ResSulfur]: 'OBJECT_RESSULFUR',

    // ---- Mine decorations ----
    [MapObjectType.MineSet1]: 'OBJECT_MINESET1',
    [MapObjectType.MineSet2]: 'OBJECT_MINESET2',
    [MapObjectType.DarkMineSet1]: 'OBJECT_DARKMINESET1',
    [MapObjectType.DarkMineSet2]: 'OBJECT_DARKMINESET2',

    // ---- Wonders / Large structures ----
    [MapObjectType.WonderCastle]: 'OBJECT_CASTLE',
    [MapObjectType.WonderColossus]: 'OBJECT_COLOSSUS',
    [MapObjectType.WonderGate]: 'OBJECT_GATE',
    [MapObjectType.WonderPharos]: 'OBJECT_PHAROS',
    [MapObjectType.Moai01]: 'OBJECT_MOAI01',
    [MapObjectType.Moai02]: 'OBJECT_MOAI02',
    [MapObjectType.WonderAlchemist]: 'OBJECT_ALCHEMIST',
    [MapObjectType.Ruin]: 'OBJECT_RUIN1',

    // ---- Trojan horse ----
    [MapObjectType.TrojanHorseBuild]: 'OBJECT_TROJANHORSE_BUILD',
    [MapObjectType.TrojanHorseStandard]: 'OBJECT_TROJANHORSE_STANDARD',
    [MapObjectType.TrojanHorseDestroyed]: 'OBJECT_TROJANHORSEDESTR',

    // ---- Column ruins ----
    [MapObjectType.ColumnRuinsA1]: 'OBJECT_COLUMNRUINS_A1',
    [MapObjectType.ColumnRuinsA2]: 'OBJECT_COLUMNRUINS_A2',
    [MapObjectType.ColumnRuinsE1]: 'OBJECT_COLUMNRUINS_E1',
    [MapObjectType.ColumnRuinsE2]: 'OBJECT_COLUMNRUINS_E2',
    [MapObjectType.ColumnRuinsE3]: 'OBJECT_COLUMNRUINS_E3',
    [MapObjectType.ColumnRuinsE4]: 'OBJECT_COLUMNRUINS_E4',
    [MapObjectType.ColumnRuinsS1]: 'OBJECT_COLUMNRUINS_S1',
    [MapObjectType.ColumnRuinsS2]: 'OBJECT_COLUMNRUINS_S2',
    [MapObjectType.ColumnRuinsS3]: 'OBJECT_COLUMNRUINS_S3',
    [MapObjectType.ColumnRuinsW1]: 'OBJECT_COLUMNRUINS_W1',
    [MapObjectType.ColumnRuinsW2]: 'OBJECT_COLUMNRUINS_W2',
    [MapObjectType.ColumnRuinsW3]: 'OBJECT_COLUMNRUINS_W3',
    [MapObjectType.ColumnRuinsW4]: 'OBJECT_COLUMNRUINS_W4',
};

/**
 * Look up ObjectInfo from objectInfo.xml by MapObjectType.
 * Throws if game data is not yet loaded or the type has no XML mapping.
 */
export function getMapObjectInfo(type: MapObjectType): ObjectInfo {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) throw new Error('getMapObjectInfo called before game data is loaded');
    const xmlId = MAP_OBJECT_TYPE_TO_XML_ID[type];
    if (!xmlId) throw new Error(`No XML mapping for MapObjectType ${MapObjectType[type]}`);
    const info = loader.getObject(xmlId);
    if (!info) throw new Error(`No ObjectInfo found for ${xmlId}`);
    return info;
}

/** Get the XML object ID for a MapObjectType, or undefined if unmapped. */
export function mapObjectTypeToXmlId(type: MapObjectType): string | undefined {
    return MAP_OBJECT_TYPE_TO_XML_ID[type];
}

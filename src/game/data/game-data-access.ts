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
import { Race } from '../core/race';
import { BuildingType } from '../buildings/building-type';
import { UnitType } from '../core/unit-types';
import { EMaterialType } from '../economy/material-type';
import { MapObjectType } from '../types/map-object-types';
import { isBuildingAvailableForRace } from './race-availability';
import { MAP_OBJECT_TYPE_TO_XML_ID } from './map-object-xml-mapping';

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
    // Infrastructure buildings
    [BuildingType.CharcoalMaker]: 'BUILDING_CHARCOALMAKER',
    [BuildingType.Port]: 'BUILDING_PORTA',
    [BuildingType.Marketplace]: 'BUILDING_MARKETPLACE',
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

/** Check if a BuildingType has an XML mapping in buildingInfo.xml. */
export function hasBuildingXmlMapping(buildingType: BuildingType): boolean {
    return BUILDING_TYPE_TO_XML_ID[buildingType] !== undefined;
}

/** Reverse map: XML building ID → BuildingType(s). Lazy-initialized. */
let xmlIdToBuildingTypeMap: Map<string, BuildingType[]> | null = null;

/**
 * Orientation variants — race-specific rotations of the same building type.
 * Shipyard (A-H) and Port (A-H) each have 8 coastal orientation variants in XML
 * but all map to a single BuildingType. The primary variant (A) is in BUILDING_TYPE_TO_XML_ID;
 * the remaining B-H variants are registered here.
 */
const ORIENTATION_VARIANTS: [string, BuildingType][] = [
    ['BUILDING_SHIPYARDB', BuildingType.Shipyard],
    ['BUILDING_SHIPYARDC', BuildingType.Shipyard],
    ['BUILDING_SHIPYARDD', BuildingType.Shipyard],
    ['BUILDING_SHIPYARDE', BuildingType.Shipyard],
    ['BUILDING_SHIPYARDF', BuildingType.Shipyard],
    ['BUILDING_SHIPYARDG', BuildingType.Shipyard],
    ['BUILDING_SHIPYARDH', BuildingType.Shipyard],
    ['BUILDING_PORTB', BuildingType.Port],
    ['BUILDING_PORTC', BuildingType.Port],
    ['BUILDING_PORTD', BuildingType.Port],
    ['BUILDING_PORTE', BuildingType.Port],
    ['BUILDING_PORTF', BuildingType.Port],
    ['BUILDING_PORTG', BuildingType.Port],
    ['BUILDING_PORTH', BuildingType.Port],
];

function ensureXmlIdMap(): Map<string, BuildingType[]> {
    if (!xmlIdToBuildingTypeMap) {
        xmlIdToBuildingTypeMap = new Map();
        for (const [btStr, xmlId] of Object.entries(BUILDING_TYPE_TO_XML_ID)) {
            const bt = Number(btStr) as BuildingType;
            const arr = xmlIdToBuildingTypeMap.get(xmlId);
            if (arr) {
                arr.push(bt);
            } else {
                xmlIdToBuildingTypeMap.set(xmlId, [bt]);
            }
        }
        for (const [xmlId, bt] of ORIENTATION_VARIANTS) {
            const arr = xmlIdToBuildingTypeMap.get(xmlId);
            if (arr) {
                arr.push(bt);
            } else {
                xmlIdToBuildingTypeMap.set(xmlId, [bt]);
            }
        }
    }
    return xmlIdToBuildingTypeMap;
}

/** Resolve XML building ID → BuildingType(s). Used by settler-data-access for building-sourced jobs. */
export function xmlIdToBuildingTypes(xmlId: string): BuildingType[] {
    const types = ensureXmlIdMap().get(xmlId);
    if (!types) {
        throw new Error(`No BuildingType mapping for XML ID: ${xmlId}`);
    }
    return types;
}

// ============ Typed game data lookups ============

/**
 * Look up BuildingInfo from game data by domain types.
 * Throws if game data is not yet loaded or the building type has no XML ID mapping.
 * Returns undefined if the XML entry is absent for this race (e.g. decorative eyecatchers).
 */
export function getBuildingInfo(race: Race, buildingType: BuildingType): BuildingInfo | undefined {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) {
        throw new Error('getBuildingInfo called before game data is loaded');
    }
    const xmlId = BUILDING_TYPE_TO_XML_ID[buildingType];
    if (!xmlId) {
        throw new Error(`No XML mapping for BuildingType ${BuildingType[buildingType]}`);
    }
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
    if (!info) {
        throw new Error(`No BuildingInfo found for ${BuildingType[buildingType]} / race ${Race[race]}`);
    }
    const { xOffset, yOffset } = info.door;
    if (xOffset === 0 && yOffset === 0) {
        return null;
    }
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
    [S4SettlerType.DIGGER]: UnitType.Digger,
    [S4SettlerType.BUILDER]: UnitType.Builder,
    [S4SettlerType.WOODCUTTER]: UnitType.Woodcutter,
    [S4SettlerType.STONECUTTER]: UnitType.Stonecutter,
    [S4SettlerType.FORESTER]: UnitType.Forester,
    [S4SettlerType.SWORDSMAN_01]: UnitType.Swordsman1,
    [S4SettlerType.SWORDSMAN_02]: UnitType.Swordsman2,
    [S4SettlerType.SWORDSMAN_03]: UnitType.Swordsman3,
    [S4SettlerType.BOWMAN_01]: UnitType.Bowman1,
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
    [S4SettlerType.MEDIC_01]: UnitType.Medic1,
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
    [S4SettlerType.AXEWARRIOR_01]: UnitType.AxeWarrior1,
    [S4SettlerType.AXEWARRIOR_02]: UnitType.AxeWarrior2,
    [S4SettlerType.AXEWARRIOR_03]: UnitType.AxeWarrior3,
    [S4SettlerType.BLOWGUNWARRIOR_01]: UnitType.BlowgunWarrior1,
    [S4SettlerType.BLOWGUNWARRIOR_02]: UnitType.BlowgunWarrior2,
    [S4SettlerType.BLOWGUNWARRIOR_03]: UnitType.BlowgunWarrior3,
    [S4SettlerType.BACKPACKCATAPULTIST_01]: UnitType.BackpackCatapultist1,
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
    if (!xmlSettler) {
        return undefined;
    }
    const name = xmlSettler.replace('SETTLER_', '');
    if (!(name in S4SettlerType)) {
        return undefined;
    }
    return S4_TO_UNIT_TYPE[S4SettlerType[name as keyof typeof S4SettlerType]];
}

/** Convert XML good string (e.g. "GOOD_PICKAXE") to EMaterialType. */
export function xmlGoodToMaterialType(xmlGood: string): EMaterialType | undefined {
    if (!xmlGood || xmlGood === 'GOOD_NO_GOOD') {
        return undefined;
    }
    const name = xmlGood.replace('GOOD_', '');
    if (!(name in S4GoodType)) {
        return undefined;
    }
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
    if (!info?.inhabitant) {
        return undefined;
    }

    const unitType = xmlSettlerToUnitType(info.inhabitant);
    if (unitType === undefined) {
        return undefined;
    }

    const tool = xmlGoodToMaterialType(info.tool);
    return { unitType, tool };
}

/**
 * Get all building types where a worker unit type can work, derived from XML.
 * This is the reverse lookup of getBuildingWorkerInfo: given a UnitType, find matching buildings.
 * Returns undefined if unit type has no workplace.
 */
export function getWorkerBuildingTypes(race: Race, unitType: UnitType): ReadonlySet<BuildingType> | undefined {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) {
        throw new Error('getWorkerBuildingTypes called before game data is loaded');
    }

    let raceMap = workerBuildingCache.get(race);
    if (!raceMap) {
        raceMap = new Map<UnitType, Set<BuildingType>>();
        for (const btStr of Object.keys(BUILDING_TYPE_TO_XML_ID)) {
            const bt = Number(btStr) as BuildingType;
            if (!isBuildingAvailableForRace(bt, race)) {
                continue;
            }
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
 * Look up ObjectInfo from objectInfo.xml by MapObjectType.
 * Throws if game data is not yet loaded or the type has no XML mapping.
 */
export function getMapObjectInfo(type: MapObjectType): ObjectInfo {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) {
        throw new Error('getMapObjectInfo called before game data is loaded');
    }
    const xmlId = MAP_OBJECT_TYPE_TO_XML_ID[type];
    if (!xmlId) {
        throw new Error(`No XML mapping for MapObjectType ${MapObjectType[type]}`);
    }
    const info = loader.getObject(xmlId);
    if (!info) {
        throw new Error(`No ObjectInfo found for ${xmlId}`);
    }
    return info;
}

/** Get the XML object ID for a MapObjectType, or undefined if unmapped. */
export function mapObjectTypeToXmlId(type: MapObjectType): string | undefined {
    return MAP_OBJECT_TYPE_TO_XML_ID[type];
}

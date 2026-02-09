/**
 * Building type definitions and configuration.
 * Centralized building-related types, enums, and size configurations.
 */

import type { TileCoord } from '../coordinates';
import {
    getGameDataLoader,
    getBuildingFootprintAt,
    type RaceId,
} from '@/resources/game-data';

export enum BuildingType {
    WoodcutterHut = 1,
    StorageArea = 2,
    Sawmill = 3,
    StonecutterHut = 4,
    GrainFarm = 5,
    Mill = 6,
    Bakery = 7,
    FisherHut = 8,
    AnimalRanch = 9,
    Slaughterhouse = 10,
    WaterworkHut = 11,
    CoalMine = 12,
    IronMine = 13,
    GoldMine = 14,
    IronSmelter = 15,
    SmeltGold = 16,
    WeaponSmith = 17,
    ToolSmith = 18,
    Barrack = 19,
    ForesterHut = 20,
    LivingHouse = 21,
    GuardTowerSmall = 22,
    HunterHut = 24,
    DonkeyRanch = 25,
    StoneMine = 26,
    SulfurMine = 27,
    HealerHut = 28,
    ResidenceSmall = 29,
    ResidenceMedium = 30,
    ResidenceBig = 31,
    GuardTowerBig = 32,
    Castle = 33,
    AmmunitionMaker = 34,
    SmallTemple = 35,
    LargeTemple = 36,
    LookoutTower = 37,
    Shipyard = 38,
    Decoration = 39,
    WinePress = 40,
    SiegeWorkshop = 41,
    LargeDecoration = 42,
}

/**
 * Map BuildingType enum values to XML building IDs.
 * Note: Some buildings have race-specific variants in XML (SHIPYARDA-H, PORTA-H)
 * but we use a single BuildingType for them.
 */
export const BUILDING_TYPE_TO_XML_ID: Partial<Record<BuildingType, string>> = {
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
    [BuildingType.WinePress]: 'BUILDING_VINYARD',
    [BuildingType.SiegeWorkshop]: 'BUILDING_VEHICLEHALL',
};

/**
 * Get the XML building ID for a BuildingType.
 * Returns undefined for types without XML mapping (e.g., decorations).
 */
export function getBuildingXmlId(buildingType: BuildingType): string | undefined {
    return BUILDING_TYPE_TO_XML_ID[buildingType];
}

/**
 * Building footprint size in tiles (width x height).
 * Most buildings are 2x2, some are 3x3, decorations are 1x1.
 */
export interface BuildingSize {
    width: number;
    height: number;
}

/** Building footprint sizes for each building type */
export const BUILDING_SIZE: Record<number, BuildingSize> = {
    // Small buildings (1x1)
    [BuildingType.Decoration]: { width: 1, height: 1 },

    // Medium buildings (2x2) - most production buildings
    [BuildingType.WoodcutterHut]: { width: 2, height: 2 },
    [BuildingType.Sawmill]: { width: 2, height: 2 },
    [BuildingType.StonecutterHut]: { width: 2, height: 2 },
    [BuildingType.GrainFarm]: { width: 2, height: 2 },
    [BuildingType.Mill]: { width: 2, height: 2 },
    [BuildingType.Bakery]: { width: 2, height: 2 },
    [BuildingType.FisherHut]: { width: 2, height: 2 },
    [BuildingType.AnimalRanch]: { width: 2, height: 2 },
    [BuildingType.Slaughterhouse]: { width: 2, height: 2 },
    [BuildingType.WaterworkHut]: { width: 2, height: 2 },
    [BuildingType.CoalMine]: { width: 2, height: 2 },
    [BuildingType.IronMine]: { width: 2, height: 2 },
    [BuildingType.GoldMine]: { width: 2, height: 2 },
    [BuildingType.IronSmelter]: { width: 2, height: 2 },
    [BuildingType.SmeltGold]: { width: 2, height: 2 },
    [BuildingType.WeaponSmith]: { width: 2, height: 2 },
    [BuildingType.ToolSmith]: { width: 2, height: 2 },
    [BuildingType.ForesterHut]: { width: 2, height: 2 },
    [BuildingType.LivingHouse]: { width: 2, height: 2 },
    [BuildingType.HunterHut]: { width: 2, height: 2 },
    [BuildingType.DonkeyRanch]: { width: 2, height: 2 },
    [BuildingType.StoneMine]: { width: 2, height: 2 },
    [BuildingType.SulfurMine]: { width: 2, height: 2 },
    [BuildingType.HealerHut]: { width: 2, height: 2 },
    [BuildingType.ResidenceSmall]: { width: 2, height: 2 },
    [BuildingType.ResidenceMedium]: { width: 2, height: 2 },
    [BuildingType.AmmunitionMaker]: { width: 2, height: 2 },
    [BuildingType.SmallTemple]: { width: 2, height: 2 },
    [BuildingType.WinePress]: { width: 2, height: 2 },

    // Military buildings (2x2)
    [BuildingType.GuardTowerSmall]: { width: 2, height: 2 },
    [BuildingType.Barrack]: { width: 2, height: 2 },
    [BuildingType.LookoutTower]: { width: 2, height: 2 },

    // Large buildings (3x3)
    [BuildingType.StorageArea]: { width: 3, height: 3 },
    [BuildingType.ResidenceBig]: { width: 3, height: 3 },
    [BuildingType.GuardTowerBig]: { width: 3, height: 3 },
    [BuildingType.Castle]: { width: 3, height: 3 },
    [BuildingType.LargeTemple]: { width: 3, height: 3 },
    [BuildingType.Shipyard]: { width: 3, height: 3 },
    [BuildingType.SiegeWorkshop]: { width: 3, height: 3 },
    [BuildingType.LargeDecoration]: { width: 3, height: 3 },
};

/** Get building size, defaults to 2x2 if not specified */
export function getBuildingSize(buildingType: BuildingType): BuildingSize {
    return BUILDING_SIZE[buildingType] ?? { width: 2, height: 2 };
}

/**
 * Get the hotspot (anchor point) offset for a building type.
 * The hotspot is used to align the building sprite with its placement position.
 *
 * Returns {x, y} offset in tile coordinates from the top-left of the footprint bitmask
 * to the building's anchor/placement point.
 *
 * @param buildingType Type of building
 * @param raceId Optional race ID (defaults to RACE_ROMAN)
 * @returns Hotspot offset {x, y} in tile units, or null if not available
 */
export function getBuildingHotspot(
    buildingType: BuildingType,
    raceId: RaceId = 'RACE_ROMAN'
): { x: number; y: number } | null {
    const loader = getGameDataLoader();
    if (!loader.isLoaded()) return null;

    const xmlId = getBuildingXmlId(buildingType);
    if (!xmlId) return null;

    const buildingInfo = loader.getBuilding(raceId, xmlId);
    if (!buildingInfo) return null;

    return {
        x: buildingInfo.hotSpotX,
        y: buildingInfo.hotSpotY,
    };
}

/**
 * Get all tile coordinates that a building occupies.
 * The input (x, y) is the building's placement/anchor position.
 *
 * If game data is loaded and the building has XML footprint data, uses the
 * actual bitmask footprint. Otherwise falls back to simple rectangular footprint.
 *
 * @param x Building placement X coordinate
 * @param y Building placement Y coordinate
 * @param buildingType Type of building
 * @param raceId Optional race ID for race-specific buildings (defaults to RACE_ROMAN)
 */
export function getBuildingFootprint(
    x: number,
    y: number,
    buildingType: BuildingType,
    raceId: RaceId = 'RACE_ROMAN'
): TileCoord[] {
    // Try to get real footprint from game data
    const loader = getGameDataLoader();
    if (loader.isLoaded()) {
        const xmlId = getBuildingXmlId(buildingType);
        if (xmlId) {
            const buildingInfo = loader.getBuilding(raceId, xmlId);
            if (buildingInfo && buildingInfo.buildingPosLines.length > 0) {
                return getBuildingFootprintAt(buildingInfo, x, y);
            }
        }
    }

    // Fallback to simple rectangular footprint
    const size = getBuildingSize(buildingType);
    const tiles: TileCoord[] = [];
    for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
            tiles.push({ x: x + dx, y: y + dy });
        }
    }
    return tiles;
}

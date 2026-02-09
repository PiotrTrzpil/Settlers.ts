/**
 * Building type definitions and configuration.
 * Centralized building-related types, enums, and size configurations.
 */

import type { TileCoord } from '../coordinates';

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
 * Get all tile coordinates that a building occupies.
 * The input (x, y) is the top-left corner of the building footprint.
 */
export function getBuildingFootprint(x: number, y: number, buildingType: BuildingType): TileCoord[] {
    const size = getBuildingSize(buildingType);
    const tiles: TileCoord[] = [];
    for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
            tiles.push({ x: x + dx, y: y + dy });
        }
    }
    return tiles;
}

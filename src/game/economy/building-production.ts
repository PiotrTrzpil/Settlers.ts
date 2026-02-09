/**
 * Production chain data and construction costs for buildings.
 * Adapted from JSettlers MaterialsOfBuildings for Settlers 4.
 */

import { BuildingType } from '../entity';
import { EMaterialType } from './material-type';

export interface ProductionChain {
    /** Materials consumed per production cycle */
    inputs: EMaterialType[];
    /** Material produced per cycle (NO_MATERIAL if none, e.g. barracks) */
    output: EMaterialType;
}

export interface ConstructionCost {
    material: EMaterialType;
    count: number;
}

/**
 * Maps each production building to its input/output materials.
 * Only buildings that participate in the economy are included.
 */
export const BUILDING_PRODUCTIONS: ReadonlyMap<BuildingType, ProductionChain> = new Map([
    // Wood industry
    [BuildingType.WoodcutterHut, { inputs: [], output: EMaterialType.LOG }],
    [BuildingType.Sawmill, { inputs: [EMaterialType.LOG], output: EMaterialType.BOARD }],
    [BuildingType.ForesterHut, { inputs: [], output: EMaterialType.NO_MATERIAL }],

    // Stone
    [BuildingType.StonecutterHut, { inputs: [], output: EMaterialType.STONE }],

    // Food industry
    [BuildingType.GrainFarm, { inputs: [], output: EMaterialType.GRAIN }],
    [BuildingType.Mill, { inputs: [EMaterialType.GRAIN], output: EMaterialType.FLOUR }],
    [BuildingType.Bakery, { inputs: [EMaterialType.FLOUR, EMaterialType.WATER], output: EMaterialType.BREAD }],
    [BuildingType.FisherHut, { inputs: [], output: EMaterialType.FISH }],
    [BuildingType.AnimalRanch, { inputs: [EMaterialType.GRAIN], output: EMaterialType.PIG }],
    [BuildingType.Slaughterhouse, { inputs: [EMaterialType.PIG], output: EMaterialType.MEAT }],
    [BuildingType.WaterworkHut, { inputs: [], output: EMaterialType.WATER }],

    // Mining (mines consume food — BREAD is the canonical food input)
    [BuildingType.CoalMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.COAL }],
    [BuildingType.IronMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.IRONORE }],
    [BuildingType.GoldMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.GOLDORE }],

    // Metal industry
    [BuildingType.IronSmelter, { inputs: [EMaterialType.IRONORE, EMaterialType.COAL], output: EMaterialType.IRONBAR }],
    [BuildingType.SmeltGold, { inputs: [EMaterialType.GOLDORE, EMaterialType.COAL], output: EMaterialType.GOLDBAR }],
    [BuildingType.WeaponSmith, { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.SWORD }],
    [BuildingType.ToolSmith, { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.AXE }],

    // Wine
    [BuildingType.WinePress, { inputs: [], output: EMaterialType.WINE }],

    // Military — barrack converts weapons to soldiers, no material output
    [BuildingType.Barrack, { inputs: [EMaterialType.SWORD], output: EMaterialType.NO_MATERIAL }],
]);

/**
 * Construction material costs for each building type.
 * Every BuildingType must have an entry.
 */
export const CONSTRUCTION_COSTS: ReadonlyMap<BuildingType, readonly ConstructionCost[]> = new Map([
    // Military
    [BuildingType.GuardTowerSmall, [
        { material: EMaterialType.BOARD, count: 4 },
        { material: EMaterialType.STONE, count: 6 },
    ]],
    [BuildingType.Barrack, [
        { material: EMaterialType.BOARD, count: 4 },
        { material: EMaterialType.STONE, count: 4 },
    ]],

    // Storage
    [BuildingType.StorageArea, [
        { material: EMaterialType.BOARD, count: 4 },
        { material: EMaterialType.STONE, count: 4 },
    ]],

    // Wood industry
    [BuildingType.WoodcutterHut, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 1 },
    ]],
    [BuildingType.Sawmill, [
        { material: EMaterialType.BOARD, count: 3 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.ForesterHut, [
        { material: EMaterialType.BOARD, count: 2 },
    ]],

    // Stone
    [BuildingType.StonecutterHut, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 1 },
    ]],

    // Food industry
    [BuildingType.GrainFarm, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 3 },
    ]],
    [BuildingType.Mill, [
        { material: EMaterialType.BOARD, count: 3 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.Bakery, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.FisherHut, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 1 },
    ]],
    [BuildingType.AnimalRanch, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.Slaughterhouse, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.WaterworkHut, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 1 },
    ]],

    // Mining
    [BuildingType.CoalMine, [
        { material: EMaterialType.BOARD, count: 3 },
    ]],
    [BuildingType.IronMine, [
        { material: EMaterialType.BOARD, count: 3 },
    ]],
    [BuildingType.GoldMine, [
        { material: EMaterialType.BOARD, count: 3 },
    ]],

    // Metal industry
    [BuildingType.IronSmelter, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 3 },
    ]],
    [BuildingType.SmeltGold, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 3 },
    ]],
    [BuildingType.WeaponSmith, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.ToolSmith, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],

    // Population
    [BuildingType.LivingHouse, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],

    // Wine
    [BuildingType.WinePress, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],

    // Additional buildings
    [BuildingType.HunterHut, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 1 },
    ]],
    [BuildingType.DonkeyRanch, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.StoneMine, [
        { material: EMaterialType.BOARD, count: 3 },
    ]],
    [BuildingType.SulfurMine, [
        { material: EMaterialType.BOARD, count: 3 },
    ]],
    [BuildingType.HealerHut, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.AmmunitionMaker, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.SiegeWorkshop, [
        { material: EMaterialType.BOARD, count: 4 },
        { material: EMaterialType.STONE, count: 3 },
    ]],

    // Houses
    [BuildingType.ResidenceSmall, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 2 },
    ]],
    [BuildingType.ResidenceMedium, [
        { material: EMaterialType.BOARD, count: 3 },
        { material: EMaterialType.STONE, count: 3 },
    ]],
    [BuildingType.ResidenceBig, [
        { material: EMaterialType.BOARD, count: 4 },
        { material: EMaterialType.STONE, count: 4 },
    ]],

    // Military structures
    [BuildingType.LookoutTower, [
        { material: EMaterialType.BOARD, count: 2 },
        { material: EMaterialType.STONE, count: 4 },
    ]],
    [BuildingType.GuardTowerBig, [
        { material: EMaterialType.BOARD, count: 6 },
        { material: EMaterialType.STONE, count: 8 },
    ]],
    [BuildingType.Castle, [
        { material: EMaterialType.BOARD, count: 8 },
        { material: EMaterialType.STONE, count: 12 },
    ]],

    // Temples
    [BuildingType.SmallTemple, [
        { material: EMaterialType.BOARD, count: 3 },
        { material: EMaterialType.STONE, count: 4 },
    ]],
    [BuildingType.LargeTemple, [
        { material: EMaterialType.BOARD, count: 5 },
        { material: EMaterialType.STONE, count: 8 },
    ]],

    // Special
    [BuildingType.Shipyard, [
        { material: EMaterialType.BOARD, count: 4 },
        { material: EMaterialType.STONE, count: 3 },
    ]],
    [BuildingType.Decoration, [
        { material: EMaterialType.STONE, count: 1 },
    ]],
    [BuildingType.LargeDecoration, [
        { material: EMaterialType.STONE, count: 2 },
    ]],
]);

/**
 * Returns all building types that consume the given material as a production input.
 */
export function getBuildingTypesRequestingMaterial(material: EMaterialType): BuildingType[] {
    const result: BuildingType[] = [];
    for (const [buildingType, chain] of BUILDING_PRODUCTIONS) {
        if (chain.inputs.includes(material)) {
            result.push(buildingType);
        }
    }
    return result;
}

/**
 * Inventory configurations for each building type.
 * Defines input/output slot configurations based on production chains.
 */

import { BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';

/**
 * Slot configuration for a building inventory.
 */
export interface SlotConfig {
    materialType: EMaterialType;
    maxCapacity: number;
}

/**
 * Complete inventory configuration for a building type.
 */
export interface InventoryConfig {
    inputSlots: SlotConfig[];
    outputSlots: SlotConfig[];
}

/** Default capacity for input slots */
export const DEFAULT_INPUT_CAPACITY = 8;

/** Default capacity for output slots */
export const DEFAULT_OUTPUT_CAPACITY = 8;

/** Default capacity for storage buildings (warehouses, storage areas) */
export const STORAGE_CAPACITY = 32;

/**
 * Inventory configurations for production buildings.
 * Based on BUILDING_PRODUCTIONS from economy/building-production.ts
 */
export const INVENTORY_CONFIGS: ReadonlyMap<BuildingType, InventoryConfig> = new Map([
    // Wood industry
    [BuildingType.WoodcutterHut, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.LOG, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.Sawmill, {
        inputSlots: [{ materialType: EMaterialType.LOG, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.BOARD, maxCapacity: DEFAULT_OUTPUT_CAPACITY * 2 }],
    }],
    [BuildingType.ForesterHut, {
        inputSlots: [],
        outputSlots: [], // Foresters plant trees, no material output
    }],

    // Stone
    [BuildingType.StonecutterHut, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.STONE, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],

    // Food industry
    [BuildingType.GrainFarm, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.GRAIN, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.Mill, {
        inputSlots: [{ materialType: EMaterialType.GRAIN, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.FLOUR, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.Bakery, {
        inputSlots: [
            { materialType: EMaterialType.FLOUR, maxCapacity: DEFAULT_INPUT_CAPACITY },
            { materialType: EMaterialType.WATER, maxCapacity: DEFAULT_INPUT_CAPACITY },
        ],
        outputSlots: [{ materialType: EMaterialType.BREAD, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.FisherHut, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.FISH, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.AnimalRanch, {
        inputSlots: [{ materialType: EMaterialType.GRAIN, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.PIG, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.Slaughterhouse, {
        inputSlots: [{ materialType: EMaterialType.PIG, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.MEAT, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.WaterworkHut, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.WATER, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.HunterHut, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.MEAT, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],

    // Mining (mines consume food)
    [BuildingType.CoalMine, {
        inputSlots: [{ materialType: EMaterialType.BREAD, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.COAL, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.IronMine, {
        inputSlots: [{ materialType: EMaterialType.BREAD, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.IRONORE, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.GoldMine, {
        inputSlots: [{ materialType: EMaterialType.BREAD, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.GOLDORE, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.StoneMine, {
        inputSlots: [{ materialType: EMaterialType.BREAD, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.STONE, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.SulfurMine, {
        inputSlots: [{ materialType: EMaterialType.BREAD, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [{ materialType: EMaterialType.SULFUR, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],

    // Metal industry
    [BuildingType.IronSmelter, {
        inputSlots: [
            { materialType: EMaterialType.IRONORE, maxCapacity: DEFAULT_INPUT_CAPACITY },
            { materialType: EMaterialType.COAL, maxCapacity: DEFAULT_INPUT_CAPACITY },
        ],
        outputSlots: [{ materialType: EMaterialType.IRONBAR, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.SmeltGold, {
        inputSlots: [
            { materialType: EMaterialType.GOLDORE, maxCapacity: DEFAULT_INPUT_CAPACITY },
            { materialType: EMaterialType.COAL, maxCapacity: DEFAULT_INPUT_CAPACITY },
        ],
        outputSlots: [{ materialType: EMaterialType.GOLDBAR, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.WeaponSmith, {
        inputSlots: [
            { materialType: EMaterialType.IRONBAR, maxCapacity: DEFAULT_INPUT_CAPACITY },
            { materialType: EMaterialType.COAL, maxCapacity: DEFAULT_INPUT_CAPACITY },
        ],
        outputSlots: [{ materialType: EMaterialType.SWORD, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],
    [BuildingType.ToolSmith, {
        inputSlots: [
            { materialType: EMaterialType.IRONBAR, maxCapacity: DEFAULT_INPUT_CAPACITY },
            { materialType: EMaterialType.COAL, maxCapacity: DEFAULT_INPUT_CAPACITY },
        ],
        outputSlots: [{ materialType: EMaterialType.AXE, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],

    // Wine
    [BuildingType.WinePress, {
        inputSlots: [],
        outputSlots: [{ materialType: EMaterialType.WINE, maxCapacity: DEFAULT_OUTPUT_CAPACITY }],
    }],

    // Military - barrack converts weapons to soldiers, no material output stored
    [BuildingType.Barrack, {
        inputSlots: [{ materialType: EMaterialType.SWORD, maxCapacity: DEFAULT_INPUT_CAPACITY }],
        outputSlots: [],
    }],

    // Storage buildings - high capacity, multi-material
    [BuildingType.StorageArea, {
        inputSlots: [], // Storage areas accept all materials dynamically
        outputSlots: [], // Storage areas provide all materials dynamically
    }],

    // Other buildings that don't produce/consume materials
    [BuildingType.LivingHouse, { inputSlots: [], outputSlots: [] }],
    [BuildingType.ResidenceSmall, { inputSlots: [], outputSlots: [] }],
    [BuildingType.ResidenceMedium, { inputSlots: [], outputSlots: [] }],
    [BuildingType.ResidenceBig, { inputSlots: [], outputSlots: [] }],
    [BuildingType.GuardTowerSmall, { inputSlots: [], outputSlots: [] }],
    [BuildingType.GuardTowerBig, { inputSlots: [], outputSlots: [] }],
    [BuildingType.LookoutTower, { inputSlots: [], outputSlots: [] }],
    [BuildingType.Castle, { inputSlots: [], outputSlots: [] }],
    [BuildingType.SmallTemple, { inputSlots: [], outputSlots: [] }],
    [BuildingType.LargeTemple, { inputSlots: [], outputSlots: [] }],
    [BuildingType.Shipyard, { inputSlots: [], outputSlots: [] }],
    [BuildingType.Decoration, { inputSlots: [], outputSlots: [] }],
    [BuildingType.LargeDecoration, { inputSlots: [], outputSlots: [] }],
    [BuildingType.DonkeyRanch, { inputSlots: [], outputSlots: [] }],
    [BuildingType.HealerHut, { inputSlots: [], outputSlots: [] }],
    [BuildingType.AmmunitionMaker, { inputSlots: [], outputSlots: [] }],
    [BuildingType.SiegeWorkshop, { inputSlots: [], outputSlots: [] }],
]);

/**
 * Get inventory configuration for a building type.
 * Returns empty config for unknown building types.
 */
export function getInventoryConfig(buildingType: BuildingType): InventoryConfig {
    return INVENTORY_CONFIGS.get(buildingType) ?? { inputSlots: [], outputSlots: [] };
}

/**
 * Check if a building type has any inventory slots.
 */
export function hasInventory(buildingType: BuildingType): boolean {
    const config = INVENTORY_CONFIGS.get(buildingType);
    if (!config) return false;
    return config.inputSlots.length > 0 || config.outputSlots.length > 0;
}

/**
 * Check if a building type is a production building (has output slots).
 */
export function isProductionBuilding(buildingType: BuildingType): boolean {
    const config = INVENTORY_CONFIGS.get(buildingType);
    return config ? config.outputSlots.length > 0 : false;
}

/**
 * Check if a building type consumes materials (has input slots).
 */
export function consumesMaterials(buildingType: BuildingType): boolean {
    const config = INVENTORY_CONFIGS.get(buildingType);
    return config ? config.inputSlots.length > 0 : false;
}

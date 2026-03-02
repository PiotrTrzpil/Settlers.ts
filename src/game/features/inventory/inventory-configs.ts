/**
 * Inventory configuration helpers for building types.
 * Derives slot configurations from BUILDING_PRODUCTIONS and BUILDING_RECIPE_SETS
 * — no manual duplication of production data.
 */

import { BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { BUILDING_PRODUCTIONS, BUILDING_RECIPE_SETS } from '../../economy/building-production';

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

/** Capacity per inventory slot (uniform for all buildings). */
export const SLOT_CAPACITY = 8;

/** @deprecated Use SLOT_CAPACITY instead. */
export const DEFAULT_INPUT_CAPACITY = SLOT_CAPACITY;

/** @deprecated Use SLOT_CAPACITY instead. */
export const DEFAULT_OUTPUT_CAPACITY = SLOT_CAPACITY;

/**
 * Derive inventory configuration for a building type from production data.
 * Multi-recipe buildings (BUILDING_RECIPE_SETS) get one output slot per recipe.
 * Single-recipe buildings (BUILDING_PRODUCTIONS) get one output slot.
 * Buildings not in either map get empty configs.
 */
export function getInventoryConfig(buildingType: BuildingType): InventoryConfig {
    // Multi-recipe buildings: collect unique inputs + one output per recipe
    const recipeSet = BUILDING_RECIPE_SETS.get(buildingType);
    if (recipeSet) {
        const inputMaterials = new Set<EMaterialType>();
        for (const recipe of recipeSet.recipes) {
            for (const input of recipe.inputs) inputMaterials.add(input);
        }
        return {
            inputSlots: [...inputMaterials].map(m => ({ materialType: m, maxCapacity: SLOT_CAPACITY })),
            outputSlots: recipeSet.recipes.map(r => ({ materialType: r.output, maxCapacity: SLOT_CAPACITY })),
        };
    }

    // Single-recipe buildings
    const production = BUILDING_PRODUCTIONS.get(buildingType);
    if (!production) return { inputSlots: [], outputSlots: [] };

    return {
        inputSlots: production.inputs.map(m => ({ materialType: m, maxCapacity: SLOT_CAPACITY })),
        outputSlots:
            production.output !== EMaterialType.NO_MATERIAL
                ? [{ materialType: production.output, maxCapacity: SLOT_CAPACITY }]
                : [],
    };
}

/**
 * Check if a building type has any inventory slots.
 */
export function hasInventory(buildingType: BuildingType): boolean {
    const config = getInventoryConfig(buildingType);
    return config.inputSlots.length > 0 || config.outputSlots.length > 0;
}

/**
 * Check if a building type is a production building (has output slots).
 */
export function isProductionBuilding(buildingType: BuildingType): boolean {
    return getInventoryConfig(buildingType).outputSlots.length > 0;
}

/**
 * Check if a building type consumes materials (has input slots).
 */
export function consumesMaterials(buildingType: BuildingType): boolean {
    return getInventoryConfig(buildingType).inputSlots.length > 0;
}

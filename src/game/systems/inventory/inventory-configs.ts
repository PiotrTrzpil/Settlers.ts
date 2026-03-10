/**
 * Inventory configuration helpers for building types.
 * Derives slot configurations entirely from XML pile data (buildingInfo.xml).
 */

import { BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { getConstructionCosts } from '../../economy/building-production';
import { Race } from '../../core/race';
import { getBuildingInfo, hasBuildingXmlMapping, xmlGoodToMaterialType } from '../../data/game-data-access';
import { PileSlotType } from '@/resources/game-data';

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

/**
 * Derive inventory configuration for a building type from XML pile data.
 * Input piles (type=1) → inputSlots. Output piles (type=0) → outputSlots.
 * Storage piles (type=4) → outputSlots with NO_MATERIAL (assigned on first deposit).
 * Buildings with no XML entry or no piles get empty configs.
 */
export function getInventoryConfig(buildingType: BuildingType, race: Race): InventoryConfig {
    if (!hasBuildingXmlMapping(buildingType)) return { inputSlots: [], outputSlots: [] };
    const info = getBuildingInfo(race, buildingType);
    if (!info) return { inputSlots: [], outputSlots: [] };

    const inputSlots: SlotConfig[] = [];
    const outputSlots: SlotConfig[] = [];

    for (const pile of info.piles) {
        if (pile.type === PileSlotType.Input) {
            const materialType = xmlGoodToMaterialType(pile.good);
            if (materialType !== undefined) inputSlots.push({ materialType, maxCapacity: SLOT_CAPACITY });
        } else if (pile.type === PileSlotType.Output) {
            const materialType = xmlGoodToMaterialType(pile.good);
            if (materialType !== undefined) outputSlots.push({ materialType, maxCapacity: SLOT_CAPACITY });
        } else {
            // Storage pile (type=4) — NO_MATERIAL slot, material assigned on first deposit
            outputSlots.push({ materialType: EMaterialType.NO_MATERIAL, maxCapacity: SLOT_CAPACITY });
        }
    }

    return { inputSlots, outputSlots };
}

/**
 * Get inventory config for a building under construction.
 * Returns input-only slots matching the building's construction material costs.
 * Each slot's maxCapacity equals the total amount needed for that material.
 */
export function getConstructionInventoryConfig(buildingType: BuildingType, race: Race): InventoryConfig {
    const costs = getConstructionCosts(buildingType, race);
    return {
        inputSlots: costs.map(c => ({ materialType: c.material, maxCapacity: c.count })),
        outputSlots: [],
    };
}

/**
 * Check if a building type has any inventory slots.
 */
export function hasInventory(buildingType: BuildingType, race: Race): boolean {
    const config = getInventoryConfig(buildingType, race);
    return config.inputSlots.length > 0 || config.outputSlots.length > 0;
}

/**
 * Check if a building type is a production building (has output slots).
 */
export function isProductionBuilding(buildingType: BuildingType, race: Race): boolean {
    return getInventoryConfig(buildingType, race).outputSlots.length > 0;
}

/**
 * Check if a building type consumes materials (has input slots).
 */
export function consumesMaterials(buildingType: BuildingType, race: Race): boolean {
    return getInventoryConfig(buildingType, race).inputSlots.length > 0;
}

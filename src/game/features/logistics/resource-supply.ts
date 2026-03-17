/**
 * Resource Supply System
 *
 * Provides functions to find available supplies of materials
 * across buildings in the game.
 */

import { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import { SlotKind } from '../../core/pile-kind';

/**
 * Information about a material supply at a building.
 */
export interface ResourceSupply {
    /** Entity ID of the building with the supply */
    buildingId: number;
    /** Type of material available */
    materialType: EMaterialType;
    /** Amount currently available in output slot */
    availableAmount: number;
    /** Slot kind of the source (Output, Storage, or Free). */
    slotKind: SlotKind;
}

/**
 * Options for filtering supply searches.
 */
export interface SupplySearchOptions {
    /** Only search within buildings owned by this player */
    playerId?: number;
    /** Minimum amount required */
    minAmount?: number;
}

/**
 * Find all buildings that have a specific material available in their output slots.
 *
 * @param gameState The game state containing entities and inventories
 * @param inventoryManager The inventory manager for building inventories
 * @param materialType Type of material to search for
 * @param options Search filters
 * @returns Array of ResourceSupply objects for buildings with the material
 */
export function getAvailableSupplies(
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    materialType: EMaterialType,
    options: SupplySearchOptions = {}
): ResourceSupply[] {
    const { playerId, minAmount = 1 } = options;
    const supplies: ResourceSupply[] = [];

    // Get all buildings that have this material in their output
    const buildingIds = inventoryManager.getSourcesWithOutput(materialType, minAmount);

    for (const buildingId of buildingIds) {
        // Filter by player if specified
        if (playerId !== undefined) {
            const building = gameState.getEntityOrThrow(buildingId, 'supply building in resource supply lookup');
            if (building.player !== playerId) {
                continue;
            }
        }

        const slot = inventoryManager.findOutputSlot(buildingId, materialType);
        if (slot && slot.currentAmount >= minAmount) {
            supplies.push({
                buildingId,
                materialType,
                availableAmount: slot.currentAmount,
                slotKind: slot.kind,
            });
        }
    }

    return supplies;
}

/**
 * Check if any building has a supply of the specified material.
 *
 * @param inventoryManager The inventory manager for building inventories
 * @param materialType Type of material to check for
 * @param minAmount Minimum amount required (default: 1)
 * @returns True if at least one building has the material available
 */
export function hasAnySupply(
    inventoryManager: BuildingInventoryManager,
    materialType: EMaterialType,
    minAmount: number = 1
): boolean {
    const buildingIds = inventoryManager.getSourcesWithOutput(materialType, minAmount);
    return buildingIds.length > 0;
}

/**
 * Get the total amount of a material available across all buildings.
 *
 * @param inventoryManager The inventory manager for building inventories
 * @param materialType Type of material to count
 * @returns Total amount available
 */
export function getTotalSupply(inventoryManager: BuildingInventoryManager, materialType: EMaterialType): number {
    const buildingIds = inventoryManager.getSourcesWithOutput(materialType, 1);
    let total = 0;

    for (const buildingId of buildingIds) {
        total += inventoryManager.getOutputAmount(buildingId, materialType);
    }

    return total;
}

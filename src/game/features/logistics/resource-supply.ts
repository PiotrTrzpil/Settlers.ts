/**
 * Resource Supply System
 *
 * Provides functions to find available supplies of materials
 * across buildings in the game.
 */

import { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import type { ServiceAreaManager } from '../service-areas/service-area-manager';
import { getBuildingsInServiceArea } from '../service-areas/service-area-queries';
import type { BuildingInventoryManager } from '../inventory';

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
}

/**
 * Options for filtering supply searches.
 */
export interface SupplySearchOptions {
    /** Only search within service areas of this player */
    playerId?: number;
    /** Only search within buildings in this service area (building ID) */
    serviceAreaBuildingId?: number;
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
    const buildingIds = inventoryManager.getBuildingsWithOutput(materialType, minAmount);

    for (const buildingId of buildingIds) {
        // Filter by player if specified
        if (playerId !== undefined) {
            const building = gameState.getEntity(buildingId);
            if (!building || building.player !== playerId) {
                continue;
            }
        }

        const amount = inventoryManager.getOutputAmount(buildingId, materialType);
        if (amount >= minAmount) {
            supplies.push({
                buildingId,
                materialType,
                availableAmount: amount,
            });
        }
    }

    return supplies;
}

/**
 * Find supplies within a specific service area.
 *
 * @param gameState The game state
 * @param inventoryManager The inventory manager for building inventories
 * @param materialType Type of material to search for
 * @param serviceAreaManager Service area manager
 * @param serviceAreaBuildingId Building ID of the service area to search within
 * @param options Additional search filters
 * @returns Array of ResourceSupply objects
 */
export function getSuppliesInServiceArea(
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    materialType: EMaterialType,
    serviceAreaManager: ServiceAreaManager,
    serviceAreaBuildingId: number,
    options: SupplySearchOptions = {}
): ResourceSupply[] {
    const { playerId, minAmount = 1 } = options;
    const serviceArea = serviceAreaManager.getServiceArea(serviceAreaBuildingId);

    if (!serviceArea) {
        return [];
    }

    // Get buildings in this service area
    const buildingsInArea = getBuildingsInServiceArea(serviceArea, gameState, {
        playerId,
    });

    const supplies: ResourceSupply[] = [];

    for (const buildingId of buildingsInArea) {
        const amount = inventoryManager.getOutputAmount(buildingId, materialType);
        if (amount >= minAmount) {
            supplies.push({
                buildingId,
                materialType,
                availableAmount: amount,
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
    const buildingIds = inventoryManager.getBuildingsWithOutput(materialType, minAmount);
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
    const buildingIds = inventoryManager.getBuildingsWithOutput(materialType, 1);
    let total = 0;

    for (const buildingId of buildingIds) {
        total += inventoryManager.getOutputAmount(buildingId, materialType);
    }

    return total;
}

/**
 * Production query helpers for BuildingInventoryManager.
 *
 * Extracted to keep building-inventory.ts under the file size limit.
 * These methods check whether a building can start/finish production
 * and perform the actual input consumption / output deposit.
 */

import { EMaterialType } from '../../economy/material-type';
import type { Recipe } from '../../economy/building-production';
import type { GameState } from '../../game-state';
import { getProductionInputs, getProductionOutput } from './building-inventory-helpers';
import type { BuildingInventoryManager } from './building-inventory';

export function canStartProduction(
    manager: BuildingInventoryManager,
    gameState: GameState,
    buildingId: number,
    recipe?: Recipe
): boolean {
    const inputs = getProductionInputs(buildingId, gameState, recipe);
    return !!inputs && inputs.every(m => manager.getInputAmount(buildingId, m) >= 1);
}

export function consumeProductionInputs(
    manager: BuildingInventoryManager,
    gameState: GameState,
    buildingId: number,
    recipe?: Recipe
): boolean {
    const inputs = getProductionInputs(buildingId, gameState, recipe);
    if (!inputs) {
        return false;
    }
    for (const material of inputs) {
        const withdrawn = manager.withdrawInput(buildingId, material, 1);
        if (withdrawn === 0) {
            throw new Error(
                `consumeProductionInputs: building ${buildingId} had no stock for ${material} — canStartProduction should have prevented this`
            );
        }
    }
    return true;
}

export function produceOutput(
    manager: BuildingInventoryManager,
    gameState: GameState,
    buildingId: number,
    recipe?: Recipe
): boolean {
    const output = getProductionOutput(buildingId, gameState, recipe);
    if (output === undefined || output === EMaterialType.NO_MATERIAL) {
        return false;
    }
    return manager.depositOutput(buildingId, output, 1) > 0;
}

export function canStoreOutput(
    manager: BuildingInventoryManager,
    gameState: GameState,
    buildingId: number,
    recipe?: Recipe
): boolean {
    const output = getProductionOutput(buildingId, gameState, recipe);
    if (output === undefined || output === EMaterialType.NO_MATERIAL) {
        return true;
    }
    const slot = manager.findOutputSlot(buildingId, output);
    return !!slot && slot.currentAmount < slot.maxCapacity;
}

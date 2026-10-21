/**
 * WORKPLACE work handler — production workers (smiths, millers, miners, …) work inside
 * their assigned building: wait for inputs and output space, consume the selected recipe's
 * inputs on start, produce its output on completion.
 *
 * Registered on the settler task system by the production-control feature, which owns
 * recipe selection. Mine buildings additionally check and consume ore within
 * {@link MINE_SEARCH_RADIUS}.
 */

import type { GameState } from '../../game-state';
import { BuildingType, type Entity } from '../../entity';
import type { BuildingInventoryManager } from '../inventory';
import { type OreVeinData, MINE_ORE_TYPE, MINE_SEARCH_RADIUS } from '../ore-veins';
import { isMineBuilding } from '../../buildings/types';
import { WorkHandlerType, type EntityWorkHandler } from '../../systems/choreo';
import { getRecipeSet, type Recipe } from '../../economy/building-production';
import { ProductionMode } from './types';
import type { ProductionControlManager } from './production-control-manager';

/** Dependencies of the WORKPLACE handler. */
export interface WorkplaceHandlerDeps {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    productionControlManager: ProductionControlManager;
    oreVeinData: OreVeinData;
    /** The settler's assigned workplace building, or null when unassigned. */
    getAssignedWorkplace: (settlerId: number) => Entity | null;
}

/** Create the handler for the WORKPLACE search type. */
export function createWorkplaceHandler(deps: WorkplaceHandlerDeps): EntityWorkHandler {
    const { gameState, inventoryManager, productionControlManager, oreVeinData, getAssignedWorkplace } = deps;
    // Tracks the recipe selected at onWorkStart so onWorkComplete produces the matching output.
    const activeRecipes = new Map<number, Recipe>();

    /** Check output-slot availability for multi-recipe or single-recipe buildings. */
    function canStoreAnyOutput(targetId: number): boolean {
        const state = productionControlManager.getProductionState(targetId);
        if (!state) {
            return inventoryManager.canStoreOutput(targetId);
        }

        // Manual mode with empty queue — building idles
        if (state.mode === ProductionMode.Manual && state.queue.length === 0) {
            return false;
        }

        // Check that at least one recipe's output slot has space
        const building = gameState.getEntityOrThrow(targetId, 'workplace canWork');
        const recipeSet = getRecipeSet(building.subType as BuildingType);
        if (!recipeSet) {
            return inventoryManager.canStoreOutput(targetId);
        }
        return recipeSet.recipes.some(r => inventoryManager.canStoreOutput(targetId, r));
    }

    /** Mine buildings require ore in the surrounding mountain tiles. */
    function hasOreForMine(targetId: number): boolean {
        const building = gameState.getEntityOrThrow(targetId, 'mine ore check');
        const bt = building.subType as BuildingType;
        if (!isMineBuilding(bt)) {
            return true;
        }
        const oreType = MINE_ORE_TYPE.get(bt);
        if (!oreType) {
            return false;
        }
        return oreVeinData.hasOreInRadius({ x: building.x, y: building.y }, MINE_SEARCH_RADIUS, oreType);
    }

    return {
        type: WorkHandlerType.ENTITY,
        shouldWaitForWork: true,

        findTarget: (_area, settlerId) => {
            // Use pre-assigned building (set by occupancy tracking in SettlerTaskSystem)
            const workplace = getAssignedWorkplace(settlerId);
            if (!workplace) {
                return null;
            }

            return { entityId: workplace.id, x: workplace.x, y: workplace.y };
        },

        canWork: (targetId: number) =>
            inventoryManager.canStartProduction(targetId) && canStoreAnyOutput(targetId) && hasOreForMine(targetId),

        onWorkStart: (targetId: number) => {
            const recipeIndex = productionControlManager.getNextRecipeIndex(targetId);
            if (recipeIndex !== null) {
                const building = gameState.getEntityOrThrow(targetId, 'workplace onWorkStart');
                const recipeSet = getRecipeSet(building.subType as BuildingType);
                if (recipeSet) {
                    const recipe = recipeSet.recipes[recipeIndex]!;
                    activeRecipes.set(targetId, recipe);
                    inventoryManager.consumeProductionInputs(targetId, recipe);
                    return;
                }
            }
            inventoryManager.consumeProductionInputs(targetId);
        },

        onWorkTick: (_targetId: number, progress: number) => {
            return progress >= 1.0;
        },

        onWorkComplete: (targetId: number) => {
            // Mine buildings consume one ore level from a nearby tile
            const building = gameState.getEntityOrThrow(targetId, 'mine ore consume');
            const bt = building.subType as BuildingType;
            if (isMineBuilding(bt)) {
                const oreType = MINE_ORE_TYPE.get(bt);
                if (oreType) {
                    oreVeinData.consumeOreInRadius({ x: building.x, y: building.y }, MINE_SEARCH_RADIUS, oreType, n =>
                        gameState.rng.nextInt(n)
                    );
                }
            }

            const recipe = activeRecipes.get(targetId);
            if (recipe) {
                activeRecipes.delete(targetId);
                inventoryManager.produceOutput(targetId, recipe);
            } else {
                inventoryManager.produceOutput(targetId);
            }
        },
    };
}

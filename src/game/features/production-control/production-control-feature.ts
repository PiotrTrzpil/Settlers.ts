/**
 * ProductionControl Feature — wraps ProductionControlManager as a self-registering feature.
 *
 * Handles its own building lifecycle:
 * - building:completed with a recipe set → initBuilding
 * - entity:removed → removeBuilding
 *
 * Owns production work: registers the WORKPLACE work handler (recipe selection,
 * production inputs/outputs, mine ore) on the settler task system.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { SettlerTaskExports } from '../settler-tasks';
import type { InventoryExports } from '../inventory';
import type { OreVeinExports } from '../ore-veins';
import { SearchType } from '../settler-tasks/types';
import { ProductionControlManager } from './production-control-manager';
import { createWorkplaceHandler } from './workplace-work-handler';
import { getRecipeSet } from '../../economy/building-production';
import type {
    SetProductionModeCommand,
    SetRecipeProportionCommand,
    AddToProductionQueueCommand,
    RemoveFromProductionQueueCommand,
} from '../../commands/command-types';
import {
    executeSetProductionMode,
    executeSetRecipeProportion,
    executeAddToProductionQueue,
    executeRemoveFromProductionQueue,
} from '../../commands/handlers/production-handlers';

export interface ProductionControlExports {
    productionControlManager: ProductionControlManager;
}

export const ProductionControlFeature: FeatureDefinition = {
    id: 'production-control',
    dependencies: ['settler-tasks', 'inventory', 'ore-veins'],

    create(ctx: FeatureContext) {
        const { settlerTaskSystem, workerAssignments } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { oreVeinData } = ctx.getFeature<OreVeinExports>('ore-veins');
        const productionControlManager = new ProductionControlManager();

        settlerTaskSystem.registerWorkHandler(
            SearchType.WORKPLACE,
            createWorkplaceHandler({
                gameState: ctx.gameState,
                inventoryManager,
                productionControlManager,
                oreVeinData,
                getAssignedWorkplace: settlerId => {
                    const buildingId = workerAssignments.getAssignedBuilding(settlerId);
                    // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
                    return buildingId === null ? null : (ctx.gameState.getEntity(buildingId) ?? null);
                },
            })
        );

        ctx.on('building:completed', ({ buildingId, buildingType }) => {
            const recipeSet = getRecipeSet(buildingType);
            if (recipeSet) {
                productionControlManager.initBuilding(buildingId, recipeSet.recipes.length);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            productionControlManager.removeBuilding(entityId);
        });

        const prodDeps = { productionControlManager };

        return {
            exports: { productionControlManager } satisfies ProductionControlExports,
            persistence: [productionControlManager.persistentStore],
            commands: {
                set_production_mode: cmd => executeSetProductionMode(prodDeps, cmd as SetProductionModeCommand),
                set_recipe_proportion: cmd => executeSetRecipeProportion(prodDeps, cmd as SetRecipeProportionCommand),
                add_to_production_queue: cmd =>
                    executeAddToProductionQueue(prodDeps, cmd as AddToProductionQueueCommand),
                remove_from_production_queue: cmd =>
                    executeRemoveFromProductionQueue(prodDeps, cmd as RemoveFromProductionQueueCommand),
            },
        };
    },
};

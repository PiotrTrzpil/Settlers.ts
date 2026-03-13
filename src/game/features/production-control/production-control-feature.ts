/**
 * ProductionControl Feature — wraps ProductionControlManager as a self-registering feature.
 *
 * Handles its own building lifecycle:
 * - building:completed with a recipe set → initBuilding
 * - entity:removed → removeBuilding
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { ProductionControlManager } from './production-control-manager';
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

    create(ctx: FeatureContext) {
        const productionControlManager = new ProductionControlManager();

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

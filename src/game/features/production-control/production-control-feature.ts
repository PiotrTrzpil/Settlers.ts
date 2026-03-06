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

export interface ProductionControlExports {
    productionControlManager: ProductionControlManager;
}

export const ProductionControlFeature: FeatureDefinition = {
    id: 'production-control',

    create(ctx: FeatureContext) {
        const productionControlManager = new ProductionControlManager();

        ctx.on('building:completed', ({ entityId, buildingType }) => {
            const recipeSet = getRecipeSet(buildingType);
            if (recipeSet) {
                productionControlManager.initBuilding(entityId, recipeSet.recipes.length);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            productionControlManager.removeBuilding(entityId);
        });

        return {
            exports: { productionControlManager } satisfies ProductionControlExports,
        };
    },
};

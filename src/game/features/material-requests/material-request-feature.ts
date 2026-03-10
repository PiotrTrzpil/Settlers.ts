/**
 * Material Request Feature - Self-registering feature module for material delivery requests.
 *
 * Creates transport requests for buildings that need input materials.
 * Dependencies are accessed via the feature registry:
 * - building-construction: ConstructionSiteManager (checks construction status)
 * - inventory: BuildingInventoryManager (checks input slot levels)
 * - logistics: RequestManager (manages delivery requests)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { MaterialRequestSystem } from './material-request-system';
import type { ConstructionSiteManager } from '../building-construction';
import type { BuildingInventoryManager } from '../inventory';
import type { RequestManager } from '../logistics';

export interface MaterialRequestExports {
    materialRequestSystem: MaterialRequestSystem;
}

export const MaterialRequestFeature: FeatureDefinition = {
    id: 'material-requests',
    dependencies: ['building-construction', 'inventory', 'logistics'],

    create(ctx: FeatureContext) {
        const { constructionSiteManager } = ctx.getFeature<{ constructionSiteManager: ConstructionSiteManager }>(
            'building-construction'
        );
        const { inventoryManager } = ctx.getFeature<{ inventoryManager: BuildingInventoryManager }>('inventory');
        const { requestManager } = ctx.getFeature<{ requestManager: RequestManager }>('logistics');

        const system = new MaterialRequestSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            requestManager,
        });

        return {
            systems: [system],
            exports: { materialRequestSystem: system } satisfies MaterialRequestExports,
            persistence: 'none',
            destroy: () => system.destroy(),
        };
    },
};

/**
 * Material Request Feature - Self-registering feature module for material delivery demands.
 *
 * Creates transport demands for buildings that need input materials.
 * Dependencies are accessed via the feature registry:
 * - building-construction: ConstructionSiteManager (checks construction status)
 * - inventory: BuildingInventoryManager (checks input slot levels)
 * - logistics: DemandQueue + TransportJobStore (manages delivery demands)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { MaterialRequestSystem } from './material-request-system';
import type { ConstructionSiteManager } from '../building-construction';
import type { BuildingInventoryManager, StorageFilterManager } from '../inventory';
import type { DemandQueueExports } from '../logistics/demand-queue-feature';

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
        const { inventoryManager, storageFilterManager } = ctx.getFeature<{
            inventoryManager: BuildingInventoryManager;
            storageFilterManager: StorageFilterManager;
        }>('inventory');
        const { demandQueue, jobStore } = ctx.getFeature<DemandQueueExports>('logistics');

        const system = new MaterialRequestSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            demandQueue,
            jobStore,
            storageFilterManager,
        });

        return {
            systems: [system],
            exports: { materialRequestSystem: system } satisfies MaterialRequestExports,
            persistence: 'none',
            destroy: () => system.destroy(),
        };
    },
};

/**
 * Material Request Feature - Self-registering feature module for material delivery demands.
 *
 * Maintains standing orders (DemandLedger targets) for operational buildings.
 * Dependencies are accessed via the feature registry:
 * - building-construction: ConstructionSiteManager (checks construction status)
 * - inventory: BuildingInventoryManager + StorageFilterManager (slot configs, import directions)
 * - logistics: DemandLedger (standing orders)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { MaterialRequestSystem } from './material-request-system';
import type { ConstructionSiteManager } from '../building-construction';
import type { BuildingInventoryManager, StorageFilterManager } from '../inventory';
import type { DemandLedgerExports } from '../logistics/demand-ledger-feature';

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
        const { demandLedger } = ctx.getFeature<DemandLedgerExports>('logistics');

        const system = new MaterialRequestSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            demandLedger,
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

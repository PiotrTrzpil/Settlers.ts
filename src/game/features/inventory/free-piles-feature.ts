/**
 * FreePiles Feature — wraps FreePileHandler as a self-registering feature.
 *
 * Territory manager is accessed lazily because it's only available after
 * terrain data is loaded.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../../systems/inventory';
import type { TerritoryExports } from '../territory/territory-feature';
import { FreePileHandler } from './free-pile-handler';

export const FreePilesFeature: FeatureDefinition = {
    id: 'free-piles',
    dependencies: ['inventory', 'territory'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const territoryExports = ctx.getFeature<TerritoryExports>('territory');

        const freePileHandler = new FreePileHandler({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            inventoryManager,
            getTerritoryManager: () => territoryExports.territoryManager!,
        });
        freePileHandler.registerEvents();

        return {
            destroy: () => freePileHandler.unregisterEvents(),
        };
    },
};

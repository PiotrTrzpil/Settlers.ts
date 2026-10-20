/**
 * FreePiles Feature — wraps FreePileHandler as a self-registering feature.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../../systems/inventory';
import type { TerritoryExports } from '../territory';
import { FreePileHandler } from './free-pile-handler';

export const FreePilesFeature: FeatureDefinition = {
    id: 'free-piles',
    dependencies: ['inventory', 'territory'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

        const freePileHandler = new FreePileHandler({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            inventoryManager,
            territoryManager,
        });
        freePileHandler.registerEvents();

        return {
            persistence: 'none',
            destroy: () => freePileHandler.unregisterEvents(),
        };
    },
};

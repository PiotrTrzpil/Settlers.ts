/**
 * FreePiles Feature — wraps FreePileHandler as a self-registering feature
 * and owns the `place_pile` command (free piles get their owner from territory).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { PlacePileCommand } from '../../commands/command-types';
import type { InventoryExports } from './inventory-feature';
import type { TerritoryExports } from '../territory';
import { FreePileHandler } from './free-pile-handler';
import { executePlacePile } from './inventory-commands';

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

        const placePileDeps = {
            state: ctx.gameState,
            terrain: ctx.terrain,
            eventBus: ctx.eventBus,
            getOwner: territoryManager.getOwner.bind(territoryManager),
        };

        return {
            persistence: 'none',
            commands: {
                place_pile: cmd => executePlacePile(placePileDeps, cmd as PlacePileCommand),
            },
            destroy: () => freePileHandler.unregisterEvents(),
        };
    },
};

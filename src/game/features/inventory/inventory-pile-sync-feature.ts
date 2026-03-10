/**
 * InventoryPileSync Feature -- creates pile entity synchronization
 * using XML game data (pile position definitions).
 *
 * - Creates BuildingPileRegistry (XML pile positions)
 * - Creates PilePositionResolver (resolves world positions for pile entities)
 * - Creates InventoryPileSync (event-driven sync between inventory and pile entities)
 *
 * Requires game data to be loaded before feature init.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../../systems/inventory';
import type { BuildingConstructionExports } from '../building-construction/building-construction-feature';
import { getGameDataLoader } from '@/resources/game-data';
import { BuildingPileRegistry } from '../../systems/inventory/building-pile-registry';
import { PilePositionResolver } from '../../systems/inventory/pile-position-resolver';
import { InventoryPileSync } from './inventory-pile-sync';

export interface InventoryPileSyncExports {
    inventoryPileSync: InventoryPileSync | null;
    pileRegistry: BuildingPileRegistry | null;
}

export const InventoryPileSyncFeature: FeatureDefinition = {
    id: 'inventory-pile-sync',
    dependencies: ['inventory', 'building-construction'],

    create(ctx: FeatureContext) {
        const { inventoryManager, pileRegistry: pileSlotRegistry } = ctx.getFeature<InventoryExports>('inventory');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');

        const dataLoader = getGameDataLoader();
        if (!dataLoader.isLoaded()) {
            throw new Error('InventoryPileSyncFeature: game data must be loaded before feature init');
        }

        const gameData = dataLoader.getData();
        const pileRegistry = new BuildingPileRegistry(gameData);
        const pilePositionResolver = new PilePositionResolver(ctx.gameState, pileRegistry, constructionSiteManager);

        const inventoryPileSync = new InventoryPileSync(
            ctx.gameState,
            inventoryManager,
            constructionSiteManager,
            pileSlotRegistry,
            pilePositionResolver,
            ctx.executeCommand
        );
        inventoryPileSync.registerEvents(ctx.eventBus, ctx.cleanupRegistry);

        return {
            exports: { inventoryPileSync, pileRegistry } satisfies InventoryPileSyncExports,
            persistence: 'none',
            destroy: () => inventoryPileSync.dispose(),
        };
    },
};

/**
 * InventoryPileSync Feature -- conditionally creates pile entity synchronization
 * when XML game data (pile position definitions) is available.
 *
 * When game data is loaded:
 * - Creates BuildingPileRegistry (XML pile positions)
 * - Creates PilePositionResolver (resolves world positions for pile entities)
 * - Creates InventoryPileSync (event-driven sync between inventory and pile entities)
 *
 * When game data is NOT loaded (e.g., test maps), this feature is a no-op.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from './inventory-feature';
import type { BuildingConstructionExports } from '../building-construction/building-construction-feature';
import { getGameDataLoader } from '@/resources/game-data';
import { BuildingPileRegistry } from './building-pile-registry';
import { PilePositionResolver } from './pile-position-resolver';
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
            return {
                exports: { inventoryPileSync: null, pileRegistry: null } satisfies InventoryPileSyncExports,
            };
        }

        const gameData = dataLoader.getData();
        const pileRegistry = new BuildingPileRegistry(gameData);
        const pilePositionResolver = new PilePositionResolver(ctx.gameState, pileRegistry);

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
            destroy: () => inventoryPileSync.dispose(),
        };
    },
};

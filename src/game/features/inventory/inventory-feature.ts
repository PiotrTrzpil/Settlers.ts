/**
 * Inventory Feature — owns building inventories (PileSlots) and StorageArea filters.
 *
 * Low-level domain feature with no feature dependencies: logistics, construction,
 * recruitment, material transfer etc. depend on it via ctx.getFeature('inventory').
 *
 * Entity cleanup:
 * - DEFAULT: drop a removed pile entity from the slot reverse index
 * - LATE: destroy a removed building's slots — must run after logistics releases
 *   its inventory reservations (CLEANUP_PRIORITY.LOGISTICS)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { SetStorageFilterCommand } from '../../commands/command-types';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import { BuildingInventoryManager } from './building-inventory';
import { StorageFilterManager } from './storage-filter-manager';
import { executeSetStorageFilter } from './inventory-commands';

export interface InventoryExports {
    inventoryManager: BuildingInventoryManager;
    storageFilterManager: StorageFilterManager;
}

export const InventoryFeature: FeatureDefinition = {
    id: 'inventory',
    dependencies: [],

    create(ctx: FeatureContext) {
        const inventoryManager = new BuildingInventoryManager();
        const storageFilterManager = new StorageFilterManager();

        ctx.cleanupRegistry.onEntityRemoved(entityId => inventoryManager.onPileEntityRemoved(entityId));
        ctx.cleanupRegistry.onEntityRemoved(
            inventoryManager.destroySlots.bind(inventoryManager),
            CLEANUP_PRIORITY.LATE
        );

        const filterDeps = {
            state: ctx.gameState,
            eventBus: ctx.eventBus,
            storageFilterManager,
            inventoryManager,
        };

        return {
            exports: { inventoryManager, storageFilterManager } satisfies InventoryExports,
            persistence: [
                { persistable: inventoryManager.slotStore, after: ['constructionSites'] },
                inventoryManager.nextSlotIdStore,
                inventoryManager.throughputStore,
                storageFilterManager.persistentStore,
            ],
            commands: {
                set_storage_filter: cmd => executeSetStorageFilter(filterDeps, cmd as SetStorageFilterCommand),
            },
        };
    },
};

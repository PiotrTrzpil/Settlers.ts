/**
 * Inventory Feature - Self-registering feature module for building inventories.
 *
 * Creates and manages the BuildingInventoryManager, PileRegistry, and StorageFilterManager.
 * Bridges inventory change callbacks to the EventBus for UI consumers.
 *
 * Inventory lifecycle:
 * - Construction inventory is created by GameServices on building:placed
 * - Production inventory is swapped in by GameServices on building:completed (via swapInventoryPhase)
 * - Inventory removal on entity:removed is handled by GameServices (after logistics cleanup)
 *
 * This feature does NOT eagerly create inventories on entity:created for buildings.
 * That was eliminated to support the two-phase lifecycle (construction vs. operational).
 *
 * Note: InventoryPileSync is wired in GameServices (not here) because it requires
 * executeCommand, which is not part of FeatureContext.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { BuildingInventoryManager, type InventoryChangeCallback } from './building-inventory';
import { PileRegistry } from './pile-registry';
import { StorageFilterManager } from './storage-filter-manager';

export interface InventoryExports {
    inventoryManager: BuildingInventoryManager;
    pileRegistry: PileRegistry;
    storageFilterManager: StorageFilterManager;
}

export const InventoryFeature: FeatureDefinition = {
    id: 'inventory',
    dependencies: [],

    create(ctx: FeatureContext) {
        const inventoryManager = new BuildingInventoryManager();
        const pileRegistry = new PileRegistry();
        const storageFilterManager = new StorageFilterManager();

        // Bridge inventory changes to EventBus for consumers (debug panel, UI)
        const onInventoryChanged: InventoryChangeCallback = (
            buildingId,
            materialType,
            slotType,
            previousAmount,
            newAmount
        ) => {
            ctx.eventBus.emit('inventory:changed', {
                buildingId,
                materialType,
                slotType,
                previousAmount,
                newAmount,
            });
        };
        inventoryManager.onChange(onInventoryChanged);

        return {
            exports: { inventoryManager, pileRegistry, storageFilterManager } satisfies InventoryExports,
            destroy: () => {
                inventoryManager.offChange(onInventoryChanged);
            },
        };
    },
};

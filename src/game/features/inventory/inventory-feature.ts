/**
 * Inventory Feature - Self-registering feature module for building inventories.
 *
 * Creates and manages the BuildingInventoryManager. Bridges inventory change callbacks
 * to the EventBus for UI consumers.
 *
 * Inventory lifecycle:
 * - Construction inventory is created by GameServices on building:placed
 * - Production inventory is created by GameServices on building:completed (swaps construction)
 * - Inventory removal on entity:removed is handled by GameServices (after logistics cleanup)
 *
 * This feature does NOT eagerly create inventories on entity:created for buildings.
 * That was eliminated to support the two-phase lifecycle (construction vs. operational).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { BuildingInventoryManager, type InventoryChangeCallback } from './building-inventory';

export interface InventoryExports {
    inventoryManager: BuildingInventoryManager;
}

export const InventoryFeature: FeatureDefinition = {
    id: 'inventory',
    dependencies: [],

    create(ctx: FeatureContext) {
        const inventoryManager = new BuildingInventoryManager();

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
            exports: { inventoryManager } satisfies InventoryExports,
            destroy: () => {
                inventoryManager.offChange(onInventoryChanged);
            },
        };
    },
};

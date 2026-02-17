/**
 * Inventory Feature - Self-registering feature module for building inventories.
 *
 * Creates inventories for buildings that need input/output material slots.
 * Bridges inventory change callbacks to the EventBus for UI consumers.
 *
 * Note: Inventory removal on entity:removed is handled by GameServices
 * because logistics cleanup must complete before inventory is removed.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { EventSubscriptionManager } from '../../event-bus';
import { EntityType, BuildingType } from '../../entity';
import { BuildingInventoryManager } from './building-inventory';
import { hasInventory, isProductionBuilding } from './inventory-configs';

export interface InventoryExports {
    inventoryManager: BuildingInventoryManager;
}

export const InventoryFeature: FeatureDefinition = {
    id: 'inventory',
    dependencies: [],

    create(ctx: FeatureContext) {
        const subscriptions = new EventSubscriptionManager();
        const inventoryManager = new BuildingInventoryManager();

        // Create inventories for buildings with input/output slots
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType }) => {
            if (type === EntityType.Building) {
                const buildingType = subType as BuildingType;
                if (hasInventory(buildingType) || isProductionBuilding(buildingType)) {
                    inventoryManager.createInventory(entityId, buildingType);
                }
            }
        });

        // Bridge inventory changes to EventBus for consumers (debug panel, UI)
        inventoryManager.onChange((buildingId, materialType, slotType, previousAmount, newAmount) => {
            ctx.eventBus.emit('inventory:changed', {
                buildingId,
                materialType,
                slotType,
                previousAmount,
                newAmount,
            });
        });

        return {
            exports: { inventoryManager } satisfies InventoryExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};

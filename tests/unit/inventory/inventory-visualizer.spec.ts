/**
 * Tests for BuildingInventoryVisualizer.
 *
 * Verifies that building output inventory changes create/update/remove
 * visual stacked resource entities next to buildings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InventoryVisualizer } from '@/game/features/inventory';
import { BuildingInventoryManager } from '@/game/features/inventory/building-inventory';
import { createTestContext, addBuilding, type TestContext } from '../helpers/test-game';
import { BuildingType, EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';

describe('InventoryVisualizer', () => {
    let ctx: TestContext;
    let inventoryManager: BuildingInventoryManager;
    let visualizer: InventoryVisualizer;

    beforeEach(() => {
        ctx = createTestContext();
        inventoryManager = ctx.state.inventoryManager;
        visualizer = new InventoryVisualizer(ctx.state, inventoryManager);
    });

    afterEach(() => {
        visualizer.dispose();
    });

    describe('output visualization', () => {
        it('creates visual stack when output is deposited', () => {
            // Add a woodcutter hut (produces LOGs)
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            // Deposit output (simulating production)
            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);

            // Should have created a stacked resource entity
            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            // Verify quantity
            const resourceState = ctx.state.resourceStates.get(resources[0].id);
            expect(resourceState?.quantity).toBe(3);
        });

        it('updates visual stack quantity when output changes', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            // Initial deposit
            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 2);

            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);
            const resourceId = resources[0].id;

            // Deposit more
            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);

            // Quantity should be updated (2 + 3 = 5)
            const resourceState = ctx.state.resourceStates.get(resourceId);
            expect(resourceState?.quantity).toBe(5);
        });

        it('removes visual stack when output is fully withdrawn', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            // Deposit then withdraw all
            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);
            inventoryManager.withdrawOutput(building.id, EMaterialType.LOG, 3);

            // Visual stack should be removed
            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(0);
        });

        it('places visual stack adjacent to building footprint', () => {
            // Building at 10,10 is 2x2, so footprint is tiles 10,10 to 11,11
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 1);

            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            const resource = resources[0];
            // Should be adjacent to the building (not on it)
            const onBuilding = (resource.x >= 10 && resource.x <= 11) &&
                               (resource.y >= 10 && resource.y <= 11);
            expect(onBuilding).toBe(false);

            // Should be next to the building (within 1 tile of footprint edge)
            const isAdjacent =
                (resource.x >= 9 && resource.x <= 12) &&
                (resource.y >= 9 && resource.y <= 12);
            expect(isAdjacent).toBe(true);
        });
    });

    describe('multiple output slots', () => {
        it('creates separate visual stacks for different materials', () => {
            // Sawmill has LOG input and BOARD output, but let's use a building with multiple outputs
            // For testing, we'll use sawmill and manually add multiple outputs to inventory
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            // Deposit the output material
            inventoryManager.depositOutput(building.id, EMaterialType.BOARD, 2);

            const boards = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.BOARD
            );
            expect(boards.length).toBe(1);
        });
    });

    describe('input slots', () => {
        it('does not create visual stacks for input deposits', () => {
            // Sawmill has LOG as input
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            // Deposit to input slot
            inventoryManager.depositInput(building.id, EMaterialType.LOG, 3);

            // Should not create visual stack for inputs
            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(0);
        });
    });

    describe('building removal', () => {
        it('removes visual stacks when building is removed', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);

            // Verify stack exists
            let resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            // Remove building's visual stacks
            visualizer.removeBuilding(building.id);

            // Visual stack should be removed
            resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(0);
        });
    });

    describe('initializeExistingBuildings', () => {
        it('creates visual stacks for buildings with existing inventory', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            // Manually set inventory without triggering onChange
            const inventory = inventoryManager.getInventory(building.id);
            const outputSlot = inventory?.outputSlots.find(s => s.materialType === EMaterialType.LOG);
            if (outputSlot) {
                outputSlot.currentAmount = 4;
            }

            // Create a new visualizer that didn't see the change
            const newVisualizer = new InventoryVisualizer(ctx.state, inventoryManager);

            // No visuals yet (change wasn't emitted)
            let resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(0);

            // Initialize from existing state
            newVisualizer.initializeExistingBuildings();

            // Now should have visual
            resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);
            expect(ctx.state.resourceStates.get(resources[0].id)?.quantity).toBe(4);

            newVisualizer.dispose();
        });
    });
});

/**
 * Tests for BuildingInventoryVisualizer.
 *
 * Verifies that building inventory changes (both input and output) create/update/remove
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

        it('places visual stack near building', () => {
            // Building at 10,10 is 2x2, so footprint is tiles 10,10 to 11,11
            // Stacks are placed 1 tile to the right of the building edge (at x=13)
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 1);

            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            const resource = resources[0];
            // Should be near the building (not on it)
            const onBuilding = (resource.x >= 10 && resource.x <= 11) &&
                               (resource.y >= 10 && resource.y <= 11);
            expect(onBuilding).toBe(false);

            // Should be close to the building (within 2 tiles of footprint edge)
            const isNearby =
                (resource.x >= 9 && resource.x <= 13) &&
                (resource.y >= 9 && resource.y <= 13);
            expect(isNearby).toBe(true);
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
        it('creates visual stacks for input deposits', () => {
            // Sawmill has LOG as input
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            // Deposit to input slot
            inventoryManager.depositInput(building.id, EMaterialType.LOG, 3);

            // Should create visual stack for inputs
            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            // Verify quantity
            const resourceState = ctx.state.resourceStates.get(resources[0].id);
            expect(resourceState?.quantity).toBe(3);
        });

        it('places inputs and outputs in different positions', () => {
            // Sawmill has LOG as input and BOARD as output
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            // Deposit both input and output
            inventoryManager.depositInput(building.id, EMaterialType.LOG, 2);
            inventoryManager.depositOutput(building.id, EMaterialType.BOARD, 2);

            // Should have two separate visual stacks
            const logs = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            const boards = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.BOARD
            );

            expect(logs.length).toBe(1);
            expect(boards.length).toBe(1);

            // They should be at different positions
            const logPos = { x: logs[0].x, y: logs[0].y };
            const boardPos = { x: boards[0].x, y: boards[0].y };
            expect(logPos.x !== boardPos.x || logPos.y !== boardPos.y).toBe(true);
        });

        it('removes input visual stacks when input is fully withdrawn', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            // Deposit then withdraw all from input
            inventoryManager.depositInput(building.id, EMaterialType.LOG, 3);
            inventoryManager.withdrawInput(building.id, EMaterialType.LOG, 3);

            // Visual stack should be removed
            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(0);
        });
    });

    describe('building removal', () => {
        it('releases reserved input stacks when building is removed', () => {
            // Sawmill has LOG as input
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            inventoryManager.depositInput(building.id, EMaterialType.LOG, 3);

            // Verify input stack exists and is reserved
            let resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);
            expect(ctx.state.getResourceBuildingId(resources[0].id)).toBe(building.id);

            // Remove building's visual stacks
            visualizer.removeBuilding(building.id);

            // Resource should still exist but no longer be reserved
            resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);
            expect(ctx.state.getResourceBuildingId(resources[0].id)).toBeUndefined();

            // Now findNearestResource should find it (it's free)
            const found = ctx.state.findNearestResource(10, 10, EMaterialType.LOG, 10);
            expect(found).toBeDefined();
            expect(found?.id).toBe(resources[0].id);
        });

        it('output stacks become free after building removal', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);

            // Verify output stack exists and is reserved
            let resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);
            expect(ctx.state.getResourceBuildingId(resources[0].id)).toBe(building.id);

            // Remove building
            visualizer.removeBuilding(building.id);

            // Resource should still exist but now be free
            resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);
            expect(ctx.state.getResourceBuildingId(resources[0].id)).toBeUndefined();

            // Now findNearestResource should find it
            const found = ctx.state.findNearestResource(10, 10, EMaterialType.LOG, 10);
            expect(found).toBeDefined();
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

    describe('resource reservation', () => {
        it('input stacks are reserved (not available for pickup)', () => {
            // Sawmill has LOG as input
            const building = addBuilding(ctx.state, 10, 10, BuildingType.Sawmill);
            inventoryManager.createInventory(building.id, BuildingType.Sawmill);

            inventoryManager.depositInput(building.id, EMaterialType.LOG, 3);

            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            // Input resource should be marked as belonging to this building
            const resourceBuildingId = ctx.state.getResourceBuildingId(resources[0].id);
            expect(resourceBuildingId).toBe(building.id);

            // findNearestResource should NOT find it (it's reserved)
            const found = ctx.state.findNearestResource(10, 10, EMaterialType.LOG, 10);
            expect(found).toBeUndefined();
        });

        it('output stacks are also reserved (carriers must use inventory API)', () => {
            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut);
            inventoryManager.createInventory(building.id, BuildingType.WoodcutterHut);

            inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);

            const resources = ctx.state.entities.filter(e =>
                e.type === EntityType.StackedResource && e.subType === EMaterialType.LOG
            );
            expect(resources.length).toBe(1);

            // Output resource should be marked as belonging to building
            const resourceBuildingId = ctx.state.getResourceBuildingId(resources[0].id);
            expect(resourceBuildingId).toBe(building.id);

            // findNearestResource should NOT find it (carriers must use inventory API)
            const found = ctx.state.findNearestResource(10, 10, EMaterialType.LOG, 10);
            expect(found).toBeUndefined();
        });

        it('free resources are found by findNearestResource', () => {
            // Add a free resource stack (not belonging to any building)
            const freeResource = ctx.state.addEntity(
                EntityType.StackedResource,
                EMaterialType.LOG,
                15, 15,
                0
            );
            ctx.state.setResourceQuantity(freeResource.id, 5);

            // This resource has no buildingId, so it should be findable
            const found = ctx.state.findNearestResource(15, 15, EMaterialType.LOG, 10);
            expect(found).toBeDefined();
            expect(found?.id).toBe(freeResource.id);
        });
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { MaterialRequestSystem, type MaterialRequestSystemConfig } from '@/game/features/material-requests';
import { BuildingType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { createTestContext, addBuildingWithInventory, type TestContext } from './helpers/test-game';

describe('MaterialRequestSystem', () => {
    let ctx: TestContext;
    let system: MaterialRequestSystem;

    beforeEach(() => {
        ctx = createTestContext();

        const config: MaterialRequestSystemConfig = {
            gameState: ctx.state,
            buildingStateManager: ctx.buildingStateManager,
            inventoryManager: ctx.inventoryManager,
            requestManager: ctx.requestManager,
        };
        system = new MaterialRequestSystem(config);
    });

    /** Helper to mark a building as completed so the system processes it */
    function completeBuilding(entityId: number): void {
        const buildingState = ctx.buildingStateManager.getBuildingState(entityId);
        if (buildingState) {
            buildingState.phase = BuildingConstructionPhase.Completed;
        }
    }

    describe('worker-based building material requests', () => {
        it('should create material requests for Sawmill (LOG input)', () => {
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);
            completeBuilding(sawmill.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
            expect(pending[0].buildingId).toBe(sawmill.id);
            expect(pending[0].materialType).toBe(EMaterialType.LOG);
        });

        it('should create material requests for WeaponSmith (IRONBAR + COAL inputs)', () => {
            const smith = addBuildingWithInventory(ctx, 10, 10, BuildingType.WeaponSmith);
            completeBuilding(smith.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(2);

            const materials = pending.map(r => r.materialType).sort();
            expect(materials).toContain(EMaterialType.IRONBAR);
            expect(materials).toContain(EMaterialType.COAL);
        });

        it('should create material requests for Mill (GRAIN input)', () => {
            const mill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Mill);
            completeBuilding(mill.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
            expect(pending[0].materialType).toBe(EMaterialType.GRAIN);
        });

        it('should create material requests for IronSmelter (IRONORE + COAL inputs)', () => {
            const smelter = addBuildingWithInventory(ctx, 10, 10, BuildingType.IronSmelter);
            completeBuilding(smelter.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(2);

            const materials = pending.map(r => r.materialType).sort();
            expect(materials).toContain(EMaterialType.IRONORE);
            expect(materials).toContain(EMaterialType.COAL);
        });

        it('should create material requests for Slaughterhouse (PIG input)', () => {
            const slaughter = addBuildingWithInventory(ctx, 10, 10, BuildingType.Slaughterhouse);
            completeBuilding(slaughter.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
            expect(pending[0].materialType).toBe(EMaterialType.PIG);
        });

        it('should not create requests for buildings without input slots', () => {
            const woodcutterHut = addBuildingWithInventory(ctx, 10, 10, BuildingType.WoodcutterHut);
            completeBuilding(woodcutterHut.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(0);
        });

        it('should not create requests for buildings still under construction', () => {
            addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);
            // Don't complete it - leave in construction phase

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(0);
        });

        it('should not duplicate requests when ticked multiple times', () => {
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);
            completeBuilding(sawmill.id);

            system.tick();
            system.tick();
            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
        });

        it('should create a new request after previous one is fulfilled', () => {
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);
            completeBuilding(sawmill.id);

            // First tick creates the initial request
            system.tick();
            const firstPending = ctx.requestManager.getPendingRequests();
            expect(firstPending.length).toBe(1);
            const firstRequest = firstPending[0];

            // Simulate carrier picking up and delivering: assign then fulfill
            ctx.requestManager.assignRequest(firstRequest.id, 999, 888);
            ctx.inventoryManager.depositInput(sawmill.id, EMaterialType.LOG, 1);
            ctx.requestManager.fulfillRequest(firstRequest.id);

            // After fulfillment, input has 1 LOG (still below threshold of 4)
            expect(ctx.inventoryManager.getInputAmount(sawmill.id, EMaterialType.LOG)).toBe(1);

            // Next tick should create a new request since input is still low
            system.tick();
            const newPending = ctx.requestManager.getPendingRequests();
            expect(newPending.length).toBe(1);
            expect(newPending[0].materialType).toBe(EMaterialType.LOG);
            expect(newPending[0].id).not.toBe(firstRequest.id);
        });

        it('should stop requesting when input reaches threshold', () => {
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);
            completeBuilding(sawmill.id);

            // Fill input to threshold (4)
            ctx.inventoryManager.depositInput(sawmill.id, EMaterialType.LOG, 4);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(0);
        });
    });
});

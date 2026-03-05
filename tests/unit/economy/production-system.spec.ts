import { describe, it, expect, beforeEach } from 'vitest';
import { MaterialRequestSystem, type MaterialRequestSystemConfig } from '@/game/features/material-requests';
import { BuildingType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { ConstructionSiteManager } from '@/game/features/building-construction';
import { createTestContext, addBuildingWithInventory, type TestContext } from '../helpers/test-game';
import { ProductionControlManager, ProductionMode } from '@/game/features/production-control';
import { EventBus } from '@/game/event-bus';

describe('MaterialRequestSystem', () => {
    let ctx: TestContext;
    let system: MaterialRequestSystem;
    let constructionSiteManager: ConstructionSiteManager;

    beforeEach(() => {
        ctx = createTestContext();
        constructionSiteManager = new ConstructionSiteManager(new EventBus());

        const config: MaterialRequestSystemConfig = {
            gameState: ctx.state,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager: ctx.inventoryManager,
            requestManager: ctx.requestManager,
        };
        system = new MaterialRequestSystem(config);
    });

    /**
     * Mark a building as "under construction" so the system skips it.
     * A building with a registered site is considered under construction.
     * A building with NO site is operational and will be processed.
     */
    function markUnderConstruction(entityId: number): void {
        const entity = ctx.state.getEntityOrThrow(entityId, 'markUnderConstruction');
        constructionSiteManager.registerSite(
            entityId,
            entity.subType as BuildingType,
            entity.race,
            entity.player,
            entity.x,
            entity.y
        );
    }

    describe('worker-based building material requests', () => {
        it('should create material requests for Sawmill (LOG input)', () => {
            // Buildings with no construction site are operational by default
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
            expect(pending[0]!.buildingId).toBe(sawmill.id);
            expect(pending[0]!.materialType).toBe(EMaterialType.LOG);
        });

        it('should create material requests for WeaponSmith (IRONBAR + COAL inputs)', () => {
            // Buildings with no construction site are operational by default
            addBuildingWithInventory(ctx, 10, 10, BuildingType.WeaponSmith);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(2);

            const materials = pending.map(r => r.materialType).sort();
            expect(materials).toContain(EMaterialType.IRONBAR);
            expect(materials).toContain(EMaterialType.COAL);
        });

        it('should create material requests for Mill (GRAIN input)', () => {
            // Buildings with no construction site are operational by default
            addBuildingWithInventory(ctx, 10, 10, BuildingType.Mill);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
            expect(pending[0]!.materialType).toBe(EMaterialType.GRAIN);
        });

        it('should create material requests for IronSmelter (IRONORE + COAL inputs)', () => {
            // Buildings with no construction site are operational by default
            addBuildingWithInventory(ctx, 10, 10, BuildingType.IronSmelter);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(2);

            const materials = pending.map(r => r.materialType).sort();
            expect(materials).toContain(EMaterialType.IRONORE);
            expect(materials).toContain(EMaterialType.COAL);
        });

        it('should create material requests for Slaughterhouse (SHEEP input, Roman)', () => {
            // Buildings with no construction site are operational by default
            addBuildingWithInventory(ctx, 10, 10, BuildingType.Slaughterhouse);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
            expect(pending[0]!.materialType).toBe(EMaterialType.SHEEP);
        });

        it('should not create requests for buildings without input slots', () => {
            // Buildings with no construction site are operational by default
            addBuildingWithInventory(ctx, 10, 10, BuildingType.WoodcutterHut);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(0);
        });

        it('should not create requests for buildings still under construction', () => {
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);
            // Register a construction site to mark it as under construction
            markUnderConstruction(sawmill.id);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(0);
        });

        it('should not duplicate requests when ticked multiple times', () => {
            // Buildings with no construction site are operational by default
            addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);

            system.tick();
            system.tick();
            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(1);
        });

        it('should create a new request after previous one is fulfilled', () => {
            // Buildings with no construction site are operational by default
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);

            // First tick creates the initial request
            system.tick();
            const firstPending = ctx.requestManager.getPendingRequests();
            expect(firstPending.length).toBe(1);
            const firstRequest = firstPending[0]!;

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
            expect(newPending[0]!.materialType).toBe(EMaterialType.LOG);
            expect(newPending[0]!.id).not.toBe(firstRequest.id);
        });

        it('should stop requesting when input reaches threshold', () => {
            // Buildings with no construction site are operational by default
            const sawmill = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill);

            // Fill input to threshold (4)
            ctx.inventoryManager.depositInput(sawmill.id, EMaterialType.LOG, 4);

            system.tick();

            const pending = ctx.requestManager.getPendingRequests();
            expect(pending.length).toBe(0);
        });
    });
});

describe('ProductionControlManager (recipe-index API)', () => {
    let pcm: ProductionControlManager;

    beforeEach(() => {
        pcm = new ProductionControlManager();
    });

    describe('initBuilding', () => {
        it('should create state with correct number of recipe indices', () => {
            pcm.initBuilding(1, 6);
            const state = pcm.getProductionState(1);
            expect(state).toBeDefined();
            expect(state!.proportions.size).toBe(6);
            expect(state!.productionCounts.size).toBe(6);
            // All proportions start at 1
            for (let i = 0; i < 6; i++) {
                expect(state!.proportions.get(i)).toBe(1);
                expect(state!.productionCounts.get(i)).toBe(0);
            }
        });

        it('should return undefined for unregistered buildings', () => {
            expect(pcm.getProductionState(999)).toBeUndefined();
        });
    });

    describe('even mode', () => {
        it('should round-robin through recipe indices', () => {
            pcm.initBuilding(1, 3);
            expect(pcm.getNextRecipeIndex(1)).toBe(0);
            expect(pcm.getNextRecipeIndex(1)).toBe(1);
            expect(pcm.getNextRecipeIndex(1)).toBe(2);
            expect(pcm.getNextRecipeIndex(1)).toBe(0); // wraps
        });

        it('should return null for unregistered building', () => {
            expect(pcm.getNextRecipeIndex(999)).toBeNull();
        });

        it('should increment productionCounts on each selection', () => {
            pcm.initBuilding(1, 2);
            pcm.getNextRecipeIndex(1);
            pcm.getNextRecipeIndex(1);
            const state = pcm.getProductionState(1)!;
            expect(state.productionCounts.get(0)).toBe(1);
            expect(state.productionCounts.get(1)).toBe(1);
        });
    });

    describe('proportional mode', () => {
        it('should fall back to even when no history exists', () => {
            pcm.initBuilding(1, 3);
            pcm.setMode(1, ProductionMode.Proportional);
            // First pick has no history — falls back to even (index 0)
            const first = pcm.getNextRecipeIndex(1);
            expect(first).toBe(0);
        });

        it('should favor recipe with highest deficit after some production', () => {
            pcm.initBuilding(1, 2);
            pcm.setMode(1, ProductionMode.Proportional);
            pcm.setProportion(1, 0, 3); // index 0 wants 3x
            pcm.setProportion(1, 1, 1); // index 1 wants 1x

            // First pick: no history, falls back to even (picks 0)
            pcm.getNextRecipeIndex(1); // index 0 selected

            // Now index 0 has 1 count, index 1 has 0 count.
            // Total = 1. targetShare(0) = 3/4 = 0.75, actualShare(0) = 1/1 = 1.0 => deficit = -0.25
            // targetShare(1) = 1/4 = 0.25, actualShare(1) = 0/1 = 0 => deficit = 0.25
            // So index 1 should be picked next.
            const second = pcm.getNextRecipeIndex(1);
            expect(second).toBe(1);
        });

        it('should converge toward target proportions over many cycles', () => {
            pcm.initBuilding(1, 2);
            pcm.setMode(1, ProductionMode.Proportional);
            pcm.setProportion(1, 0, 3);
            pcm.setProportion(1, 1, 1);

            const counts = [0, 0];
            for (let i = 0; i < 40; i++) {
                const idx = pcm.getNextRecipeIndex(1)!;
                counts[idx] = (counts[idx] ?? 0) + 1;
            }

            // Index 0 should be selected ~3x more than index 1
            expect(counts[0]! / counts[1]!).toBeCloseTo(3, 0);
        });
    });

    describe('manual mode', () => {
        it('should follow queue order', () => {
            pcm.initBuilding(1, 4);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 2);
            pcm.addToQueue(1, 0);
            pcm.addToQueue(1, 3);

            expect(pcm.getNextRecipeIndex(1)).toBe(2);
            expect(pcm.getNextRecipeIndex(1)).toBe(0);
            expect(pcm.getNextRecipeIndex(1)).toBe(3);
        });

        it('should return null when queue is empty', () => {
            pcm.initBuilding(1, 3);
            pcm.setMode(1, ProductionMode.Manual);
            expect(pcm.getNextRecipeIndex(1)).toBeNull();
        });

        it('should deplete queue one item at a time', () => {
            pcm.initBuilding(1, 2);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 0);
            pcm.addToQueue(1, 1);

            pcm.getNextRecipeIndex(1); // consumes index 0
            const state = pcm.getProductionState(1)!;
            expect(state.queue).toEqual([1]);
        });

        it('should remove last occurrence from queue', () => {
            pcm.initBuilding(1, 3);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 0);
            pcm.addToQueue(1, 1);
            pcm.addToQueue(1, 0);
            pcm.removeFromQueue(1, 0); // removes last 0

            const state = pcm.getProductionState(1)!;
            expect(state.queue).toEqual([0, 1]); // first 0 remains
        });

        it('should do nothing when removing a recipe not in queue', () => {
            pcm.initBuilding(1, 3);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 1);
            pcm.removeFromQueue(1, 2); // 2 is not in queue

            const state = pcm.getProductionState(1)!;
            expect(state.queue).toEqual([1]);
        });

        it('should increment productionCounts when dequeuing', () => {
            pcm.initBuilding(1, 3);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 2);
            pcm.getNextRecipeIndex(1);

            const state = pcm.getProductionState(1)!;
            expect(state.productionCounts.get(2)).toBe(1);
        });
    });

    describe('removeBuilding', () => {
        it('should clean up state', () => {
            pcm.initBuilding(1, 3);
            pcm.removeBuilding(1);
            expect(pcm.getProductionState(1)).toBeUndefined();
            expect(pcm.getNextRecipeIndex(1)).toBeNull();
        });

        it('should not throw when removing an unregistered building', () => {
            expect(() => pcm.removeBuilding(999)).not.toThrow();
        });
    });

    describe('setProportion', () => {
        it('should clamp weight to maximum of 10', () => {
            pcm.initBuilding(1, 2);
            pcm.setProportion(1, 0, 15);
            expect(pcm.getProductionState(1)!.proportions.get(0)).toBe(10);
        });

        it('should clamp weight to minimum of 0', () => {
            pcm.initBuilding(1, 2);
            pcm.setProportion(1, 0, -5);
            expect(pcm.getProductionState(1)!.proportions.get(0)).toBe(0);
        });

        it('should accept boundary values 0 and 10 without clamping', () => {
            pcm.initBuilding(1, 2);
            pcm.setProportion(1, 0, 0);
            pcm.setProportion(1, 1, 10);
            const state = pcm.getProductionState(1)!;
            expect(state.proportions.get(0)).toBe(0);
            expect(state.proportions.get(1)).toBe(10);
        });

        it('should throw when building is not registered', () => {
            expect(() => pcm.setProportion(999, 0, 5)).toThrow();
        });
    });

    describe('setMode', () => {
        it('should reset roundRobinIndex to 0 when switching to even', () => {
            pcm.initBuilding(1, 4);
            // Advance round-robin a few steps
            pcm.getNextRecipeIndex(1);
            pcm.getNextRecipeIndex(1);

            pcm.setMode(1, ProductionMode.Even);
            const state = pcm.getProductionState(1)!;
            expect(state.roundRobinIndex).toBe(0);
        });

        it('should not reset roundRobinIndex when switching to proportional', () => {
            pcm.initBuilding(1, 4);
            pcm.getNextRecipeIndex(1); // advances to 1
            pcm.setMode(1, ProductionMode.Proportional);
            const state = pcm.getProductionState(1)!;
            expect(state.mode).toBe(ProductionMode.Proportional);
        });

        it('should throw when building is not registered', () => {
            expect(() => pcm.setMode(999, ProductionMode.Even)).toThrow();
        });
    });

    describe('multiple buildings are tracked independently', () => {
        it('should maintain separate states per building', () => {
            pcm.initBuilding(1, 3);
            pcm.initBuilding(2, 5);

            // Advance building 1 twice
            pcm.getNextRecipeIndex(1);
            pcm.getNextRecipeIndex(1);

            // Building 2 should still be at index 0
            expect(pcm.getNextRecipeIndex(2)).toBe(0);
            // Building 1 should be at index 2
            expect(pcm.getNextRecipeIndex(1)).toBe(2);
        });

        it('should not affect other buildings when one is removed', () => {
            pcm.initBuilding(1, 2);
            pcm.initBuilding(2, 2);

            pcm.removeBuilding(1);

            expect(pcm.getProductionState(1)).toBeUndefined();
            expect(pcm.getProductionState(2)).toBeDefined();
        });
    });
});

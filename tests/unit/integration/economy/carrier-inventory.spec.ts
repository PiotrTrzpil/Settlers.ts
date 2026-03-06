/**
 * Integration tests for carriers and inventory.
 *
 * Uses the simulation harness (test-simulation.ts) for proper system wiring.
 * Tests verify that:
 * - Building placement triggers inventory and service area creation
 * - Entity removal triggers proper cleanup
 * - Resource requests are tracked correctly
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { RequestPriority, RequestStatus } from '@/game/features/logistics';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';

describe('Carriers, Inventory & Service Areas (simulation)', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ---------------------------------------------------------------------------
    // Building Creation - Inventories
    // ---------------------------------------------------------------------------

    describe('Building Creation - Inventories', () => {
        it('should create inventory with output slots for production buildings', () => {
            sim = createSimulation({ useStubData: true });
            const id = sim.placeBuilding(BuildingType.WoodcutterHut);
            const inventory = sim.services.inventoryManager.getInventory(id);
            expect(inventory).toBeDefined();
            expect(inventory!.buildingType).toBe(BuildingType.WoodcutterHut);
            expect(inventory!.outputSlots.length).toBeGreaterThan(0);
            expect(inventory!.outputSlots[0]!.materialType).toBe(EMaterialType.LOG);
        });

        it('should create inventory with input slots for processing buildings', () => {
            sim = createSimulation({ useStubData: true });
            const id = sim.placeBuilding(BuildingType.Sawmill);
            const inventory = sim.services.inventoryManager.getInventory(id);
            expect(inventory).toBeDefined();
            expect(inventory!.inputSlots.length).toBeGreaterThan(0);
            expect(inventory!.inputSlots[0]!.materialType).toBe(EMaterialType.LOG);
            expect(inventory!.outputSlots[0]!.materialType).toBe(EMaterialType.BOARD);
        });
    });

    // ---------------------------------------------------------------------------
    // Entity Removal - Cleanup
    // ---------------------------------------------------------------------------

    describe('Entity Removal - Cleanup', () => {
        it('should remove inventory when building is removed', () => {
            sim = createSimulation({ useStubData: true });
            const id = sim.placeBuilding(BuildingType.WoodcutterHut);
            expect(sim.services.inventoryManager.getInventory(id)).toBeDefined();

            sim.state.removeEntity(id);
            expect(sim.services.inventoryManager.getInventory(id)).toBeUndefined();
        });

        it('should remove carrier state when carrier unit is removed', () => {
            sim = createSimulation({ useStubData: true });
            sim.placeBuilding(BuildingType.ResidenceSmall);

            const carrierId = sim.spawnUnit(30, 30, UnitType.Carrier);
            // Carrier may already be auto-registered by the simulation; ensure it is
            if (!sim.services.carrierRegistry.has(carrierId)) {
                sim.services.carrierRegistry.register(carrierId);
            }
            expect(sim.services.carrierRegistry.has(carrierId)).toBe(true);

            sim.state.removeEntity(carrierId);
            expect(sim.services.carrierRegistry.has(carrierId)).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Resource Request Creation
    // ---------------------------------------------------------------------------

    describe('Resource Request Creation', () => {
        it('should create pending resource request with correct attributes', () => {
            sim = createSimulation({ useStubData: true });
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            const request = sim.services.requestManager.addRequest(
                sawmillId,
                EMaterialType.LOG,
                4,
                RequestPriority.Normal
            );

            expect(request).toBeDefined();
            expect(request.materialType).toBe(EMaterialType.LOG);
            expect(request.amount).toBe(4);
            expect(request.status).toBe(RequestStatus.Pending);
            expect(request.buildingId).toBe(sawmillId);
        });

        it('should track request in pending requests list', () => {
            sim = createSimulation({ useStubData: true });
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            sim.services.requestManager.addRequest(sawmillId, EMaterialType.LOG, 4);

            expect(sim.services.requestManager.getPendingCount()).toBe(1);
            const pending = sim.services.requestManager.getPendingRequests();
            expect(pending).toHaveLength(1);
            expect(pending[0]!.materialType).toBe(EMaterialType.LOG);
        });
    });

    // ---------------------------------------------------------------------------
    // Full Integration Scenario
    // ---------------------------------------------------------------------------

    describe('Full Integration Scenario', () => {
        it('should handle complete building lifecycle', () => {
            sim = createSimulation({ useStubData: true });

            // 1. Woodcutter gets inventory
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            expect(sim.services.inventoryManager.getInventory(woodcutterId)).toBeDefined();

            // 2. Carrier registration
            const carrierId = sim.spawnUnit(30, 30, UnitType.Carrier);
            if (!sim.services.carrierRegistry.has(carrierId)) {
                sim.services.carrierRegistry.register(carrierId);
            }
            expect(sim.services.carrierRegistry.has(carrierId)).toBe(true);

            // 3. Remove everything - all should clean up
            sim.state.removeEntity(woodcutterId);
            sim.state.removeEntity(carrierId);

            expect(sim.services.inventoryManager.getInventory(woodcutterId)).toBeUndefined();
            expect(sim.services.carrierRegistry.has(carrierId)).toBe(false);
        });
    });
});

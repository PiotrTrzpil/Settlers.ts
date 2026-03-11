/**
 * Integration tests for carriers and inventory.
 *
 * Uses the simulation harness (test-simulation.ts) for proper system wiring.
 * Tests verify that:
 * - Building placement triggers inventory and service area creation
 * - Entity removal triggers proper cleanup
 * - Demands are tracked correctly via DemandQueue
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { DemandPriority } from '@/game/features/logistics/demand-queue';
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
    // Demand Creation
    // ---------------------------------------------------------------------------

    describe('Demand Creation', () => {
        it('should create demand with correct attributes', () => {
            sim = createSimulation({ useStubData: true });
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            const demand = sim.services.demandQueue.addDemand(sawmillId, EMaterialType.LOG, 4, DemandPriority.Normal);

            expect(demand).toBeDefined();
            expect(demand.materialType).toBe(EMaterialType.LOG);
            expect(demand.amount).toBe(4);
            expect(demand.priority).toBe(DemandPriority.Normal);
            expect(demand.buildingId).toBe(sawmillId);
        });

        it('should track demand in sorted demands list', () => {
            sim = createSimulation({ useStubData: true });
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            sim.services.demandQueue.addDemand(sawmillId, EMaterialType.LOG, 4, DemandPriority.Normal);

            expect(sim.services.demandQueue.size).toBe(1);
            const demands = sim.services.demandQueue.getSortedDemands();
            expect(demands).toHaveLength(1);
            expect(demands[0]!.materialType).toBe(EMaterialType.LOG);
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

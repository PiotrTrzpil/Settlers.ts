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
import { SlotKind } from '@/game/core/pile-kind';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';

installRealGameData();

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
            sim = createSimulation();
            const id = sim.placeBuilding(BuildingType.WoodcutterHut);
            expect(sim.services.inventoryManager.hasSlots(id)).toBe(true);
            const slots = sim.services.inventoryManager.getSlots(id);
            const outputSlots = slots.filter(s => s.kind === SlotKind.Output);
            expect(outputSlots.length).toBeGreaterThan(0);
            expect(outputSlots[0]!.materialType).toBe(EMaterialType.LOG);
        });

        it('should create inventory with input slots for processing buildings', () => {
            sim = createSimulation();
            const id = sim.placeBuilding(BuildingType.Sawmill);
            expect(sim.services.inventoryManager.hasSlots(id)).toBe(true);
            const slots = sim.services.inventoryManager.getSlots(id);
            const inputSlots = slots.filter(s => s.kind === SlotKind.Input);
            const outputSlots = slots.filter(s => s.kind === SlotKind.Output);
            expect(inputSlots.length).toBeGreaterThan(0);
            expect(inputSlots[0]!.materialType).toBe(EMaterialType.LOG);
            expect(outputSlots[0]!.materialType).toBe(EMaterialType.BOARD);
        });
    });

    // ---------------------------------------------------------------------------
    // Entity Removal - Cleanup
    // ---------------------------------------------------------------------------

    describe('Entity Removal - Cleanup', () => {
        it('should remove inventory when building is removed', () => {
            sim = createSimulation();
            const id = sim.placeBuilding(BuildingType.WoodcutterHut);
            expect(sim.services.inventoryManager.hasSlots(id)).toBe(true);

            sim.state.removeEntity(id);
            expect(sim.services.inventoryManager.hasSlots(id)).toBe(false);
        });

        it('should remove carrier state when carrier unit is removed', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);

            const carrierId = sim.spawnUnit({ x: 30, y: 30 }, UnitType.Carrier);
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
            sim = createSimulation();
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            const demand = sim.services.demandQueue.addDemand(sawmillId, EMaterialType.LOG, 4, DemandPriority.Normal);

            expect(demand).toBeDefined();
            expect(demand.materialType).toBe(EMaterialType.LOG);
            expect(demand.amount).toBe(4);
            expect(demand.priority).toBe(DemandPriority.Normal);
            expect(demand.buildingId).toBe(sawmillId);
        });

        it('should track demand in sorted demands list', () => {
            sim = createSimulation();
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
            sim = createSimulation();

            // 1. Woodcutter gets inventory
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            expect(sim.services.inventoryManager.hasSlots(woodcutterId)).toBe(true);

            // 2. Carrier registration
            const carrierId = sim.spawnUnit({ x: 30, y: 30 }, UnitType.Carrier);
            if (!sim.services.carrierRegistry.has(carrierId)) {
                sim.services.carrierRegistry.register(carrierId);
            }
            expect(sim.services.carrierRegistry.has(carrierId)).toBe(true);

            // 3. Remove everything - all should clean up
            sim.state.removeEntity(woodcutterId);
            sim.state.removeEntity(carrierId);

            expect(sim.services.inventoryManager.hasSlots(woodcutterId)).toBe(false);
            expect(sim.services.carrierRegistry.has(carrierId)).toBe(false);
        });
    });
});

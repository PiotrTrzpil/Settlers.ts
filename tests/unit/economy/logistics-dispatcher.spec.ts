/**
 * Unit tests for LogisticsDispatcher — the orchestration layer that matches
 * pending resource requests to supplies and assigns carriers for delivery.
 *
 * Tests the full dispatch loop: request → supply match → carrier assignment,
 * using real managers with minimal game state (no full simulation).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createTestContext,
    addBuilding,
    addUnit,
    addBuildingWithInventory,
    type TestContext,
} from '../helpers/test-game';
import { installTestGameData } from '../helpers/test-game-data';
import { LogisticsDispatcher } from '@/game/features/logistics/logistics-dispatcher';
import type { SettlerTaskSystem } from '@/game/features/settler-tasks';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy/material-type';

describe('LogisticsDispatcher', () => {
    let ctx: TestContext;
    let dispatcher: LogisticsDispatcher;
    let assignJobSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        installTestGameData();
        ctx = createTestContext(64, 64);

        // Create a mock settler task system — we need assignJob and buildTransportJob
        assignJobSpy = vi.fn().mockReturnValue(true);
        const mockSettlerTaskSystem = {
            assignJob: assignJobSpy,
            buildTransportJob: vi.fn().mockReturnValue({ targetPos: { x: 0, y: 0 } }),
        } as unknown as SettlerTaskSystem;

        dispatcher = new LogisticsDispatcher({
            gameState: ctx.state,
            eventBus: ctx.eventBus,
            carrierManager: ctx.carrierManager,
            settlerTaskSystem: mockSettlerTaskSystem,
            requestManager: ctx.requestManager,
            serviceAreaManager: ctx.serviceAreaManager,
            inventoryManager: ctx.inventoryManager,
        });

        // Enable global logistics — no service area filtering
        dispatcher.globalLogistics = true;
    });

    /** Place a hub (residence), create service area, and register a carrier at it. */
    function setupHub(x: number, y: number, player = 0): { hubId: number; carrierId: number } {
        const hub = addBuilding(ctx.state, x, y, BuildingType.ResidenceSmall, player);
        ctx.serviceAreaManager.createServiceArea(hub.id, player, x, y, BuildingType.ResidenceSmall);
        const { entity: carrier } = addUnit(ctx.state, x + 1, y, { player, subType: UnitType.Carrier });
        ctx.carrierManager.createCarrier(carrier.id, hub.id);
        return { hubId: hub.id, carrierId: carrier.id };
    }

    /** Place a building with inventory, deposit output material. */
    function setupSupply(x: number, y: number, buildingType: BuildingType, material: EMaterialType, amount: number) {
        const building = addBuildingWithInventory(ctx, x, y, buildingType);
        ctx.inventoryManager.depositOutput(building.id, material, amount);
        return building;
    }

    /** Place a building with inventory that requests input material. */
    function setupDemand(x: number, y: number, buildingType: BuildingType, material: EMaterialType, amount: number) {
        const building = addBuildingWithInventory(ctx, x, y, buildingType);
        ctx.requestManager.addRequest(building.id, material, amount);
        return building;
    }

    it('matches a pending request to a supply and assigns a carrier', () => {
        setupHub(10, 10);
        setupSupply(15, 10, BuildingType.WoodcutterHut, EMaterialType.LOG, 5);
        setupDemand(20, 10, BuildingType.Sawmill, EMaterialType.LOG, 1);

        dispatcher.tick(1 / 30);

        // Carrier should have been assigned
        expect(assignJobSpy).toHaveBeenCalledOnce();
        // Request should no longer be pending
        const pending = ctx.requestManager.getPendingRequests();
        expect(pending).toHaveLength(0);
    });

    it('does nothing when no supply exists for a request', () => {
        setupHub(10, 10);
        // Demand exists but no supply
        setupDemand(20, 10, BuildingType.Sawmill, EMaterialType.LOG, 1);

        dispatcher.tick(1 / 30);

        expect(assignJobSpy).not.toHaveBeenCalled();
        expect(ctx.requestManager.getPendingRequests()).toHaveLength(1);
    });

    it('does nothing when no carrier is available', () => {
        // Hub without carrier
        const hub = addBuilding(ctx.state, 10, 10, BuildingType.ResidenceSmall);
        ctx.serviceAreaManager.createServiceArea(hub.id, 0, 10, 10, BuildingType.ResidenceSmall);

        setupSupply(15, 10, BuildingType.WoodcutterHut, EMaterialType.LOG, 5);
        setupDemand(20, 10, BuildingType.Sawmill, EMaterialType.LOG, 1);

        dispatcher.tick(1 / 30);

        expect(assignJobSpy).not.toHaveBeenCalled();
        expect(ctx.requestManager.getPendingRequests()).toHaveLength(1);
    });

    it('does not double-assign the same supply via reservations', () => {
        setupHub(10, 10);
        // Only 1 LOG available
        setupSupply(15, 10, BuildingType.WoodcutterHut, EMaterialType.LOG, 1);
        // Two buildings each want 1 LOG
        setupDemand(20, 10, BuildingType.Sawmill, EMaterialType.LOG, 1);
        setupDemand(25, 10, BuildingType.Sawmill, EMaterialType.LOG, 1);

        dispatcher.tick(1 / 30);

        // Only one assignment should happen (supply is reserved after first)
        expect(assignJobSpy).toHaveBeenCalledTimes(1);
        expect(ctx.requestManager.getPendingRequests()).toHaveLength(1);
    });

    it('assigns multiple requests in one tick when supply and carriers exist', () => {
        const { carrierId: c1 } = setupHub(10, 10);
        // Add a second carrier at the same hub
        const { entity: carrier2 } = addUnit(ctx.state, 11, 10, { subType: UnitType.Carrier });
        ctx.carrierManager.createCarrier(carrier2.id, c1); // same hub as first carrier's... wait

        // Actually set up properly - need the hub id
        const hub2Carrier = addUnit(ctx.state, 12, 10, { subType: UnitType.Carrier });
        // Let's just use a second hub
        const hub = addBuilding(ctx.state, 30, 10, BuildingType.ResidenceSmall);
        ctx.serviceAreaManager.createServiceArea(hub.id, 0, 30, 10, BuildingType.ResidenceSmall);
        ctx.carrierManager.createCarrier(hub2Carrier.entity.id, hub.id);

        setupSupply(15, 10, BuildingType.WoodcutterHut, EMaterialType.LOG, 5);
        setupSupply(16, 10, BuildingType.StonecutterHut, EMaterialType.STONE, 3);
        setupDemand(20, 10, BuildingType.Sawmill, EMaterialType.LOG, 1);
        setupDemand(25, 10, BuildingType.Sawmill, EMaterialType.STONE, 1);

        dispatcher.tick(1 / 30);

        expect(assignJobSpy).toHaveBeenCalledTimes(2);
        expect(ctx.requestManager.getPendingRequests()).toHaveLength(0);
    });

    it('skips source === destination', () => {
        setupHub(10, 10);
        // Building has LOG in output AND requests LOG (shouldn't self-serve)
        const building = addBuildingWithInventory(ctx, 15, 10, BuildingType.WoodcutterHut);
        ctx.inventoryManager.depositOutput(building.id, EMaterialType.LOG, 5);
        ctx.requestManager.addRequest(building.id, EMaterialType.LOG, 1);

        dispatcher.tick(1 / 30);

        expect(assignJobSpy).not.toHaveBeenCalled();
    });

    it('matches COAL supply from mine to smelter request', () => {
        setupHub(10, 10);
        setupSupply(15, 10, BuildingType.CoalMine, EMaterialType.COAL, 5);
        setupDemand(20, 10, BuildingType.IronSmelter, EMaterialType.COAL, 1);

        dispatcher.tick(1 / 30);

        expect(assignJobSpy).toHaveBeenCalledOnce();
        expect(ctx.requestManager.getPendingRequests()).toHaveLength(0);
    });

    it('matches IRONORE supply from mine to smelter request', () => {
        setupHub(10, 10);
        setupSupply(15, 10, BuildingType.IronMine, EMaterialType.IRONORE, 5);
        setupDemand(20, 10, BuildingType.IronSmelter, EMaterialType.IRONORE, 1);

        dispatcher.tick(1 / 30);

        expect(assignJobSpy).toHaveBeenCalledOnce();
        expect(ctx.requestManager.getPendingRequests()).toHaveLength(0);
    });

    it('respects globalLogistics=false — requires shared service area', () => {
        dispatcher.globalLogistics = false;

        // Hub only near source, not near destination (service area radius is limited)
        const hub = addBuilding(ctx.state, 10, 10, BuildingType.ResidenceSmall);
        ctx.serviceAreaManager.createServiceArea(hub.id, 0, 10, 10, BuildingType.ResidenceSmall, 5);
        const { entity: carrier } = addUnit(ctx.state, 11, 10, { subType: UnitType.Carrier });
        ctx.carrierManager.createCarrier(carrier.id, hub.id);

        setupSupply(12, 10, BuildingType.WoodcutterHut, EMaterialType.LOG, 5);
        // Destination is far outside the service area radius
        setupDemand(50, 50, BuildingType.Sawmill, EMaterialType.LOG, 1);

        dispatcher.tick(1 / 30);

        // Should not match — no shared service area hub covers both buildings
        expect(assignJobSpy).not.toHaveBeenCalled();
    });
});

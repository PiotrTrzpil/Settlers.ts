// @vitest-environment jsdom
/**
 * Integration tests for Wave 1 systems: carriers, inventory, and service areas.
 *
 * Tests verify that:
 * - Managers are initialized in GameState
 * - Building creation triggers inventory and service area creation
 * - Entity removal triggers proper cleanup
 * - The systems work together correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState } from '@/game/game-state';
import { GameLoop } from '@/game/game-loop';
import { EventBus } from '@/game/event-bus';
import { EntityType, BuildingType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { RequestPriority, RequestStatus } from '@/game/features/logistics';

describe('Wave 1 Integration: Carriers, Inventory, Service Areas', () => {
    let gameState: GameState;
    let gameLoop: GameLoop;
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus();
        gameState = new GameState(eventBus);
        gameLoop = new GameLoop(gameState, eventBus);
    });

    // ---------------------------------------------------------------------------
    // Manager Initialization
    // ---------------------------------------------------------------------------

    describe('Manager Initialization', () => {
        it('should have carrierManager initialized in GameLoop', () => {
            expect(gameLoop.carrierManager).toBeDefined();
            expect(gameLoop.carrierManager.size).toBe(0);
        });

        it('should have inventoryManager initialized in GameLoop', () => {
            expect(gameLoop.inventoryManager).toBeDefined();
        });

        it('should have serviceAreaManager initialized in GameLoop', () => {
            expect(gameLoop.serviceAreaManager).toBeDefined();
        });

        it('should have carrierSystem registered in GameLoop', () => {
            expect(gameLoop.carrierSystem).toBeDefined();
        });
    });

    // ---------------------------------------------------------------------------
    // Building Creation - Service Areas
    // ---------------------------------------------------------------------------

    describe('Building Creation - Service Areas', () => {
        it('should create service area when ResidenceSmall (tavern) is created', () => {
            const entity = gameState.addEntity(
                EntityType.Building,
                BuildingType.ResidenceSmall,
                10,
                10,
                1 // player 1
            );

            const serviceArea = gameLoop.serviceAreaManager.getServiceArea(entity.id);
            expect(serviceArea).toBeDefined();
            expect(serviceArea?.buildingId).toBe(entity.id);
            expect(serviceArea?.centerX).toBe(10);
            expect(serviceArea?.centerY).toBe(10);
            expect(serviceArea?.playerId).toBe(1);
        });

        it('should NOT create service area for StorageArea (not a logistics hub)', () => {
            const entity = gameState.addEntity(EntityType.Building, BuildingType.StorageArea, 20, 20, 1);

            // StorageArea is storage only, not a carrier hub
            const serviceArea = gameLoop.serviceAreaManager.getServiceArea(entity.id);
            expect(serviceArea).toBeUndefined();
        });

        it('should NOT create service area for non-logistics buildings', () => {
            const entity = gameState.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 30, 30, 1);

            const serviceArea = gameLoop.serviceAreaManager.getServiceArea(entity.id);
            expect(serviceArea).toBeUndefined();
        });
    });

    // ---------------------------------------------------------------------------
    // Building Creation - Inventories
    // ---------------------------------------------------------------------------

    describe('Building Creation - Inventories', () => {
        it('should create inventory when production building is created', () => {
            const entity = gameState.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 10, 10, 1);

            const inventory = gameLoop.inventoryManager.getInventory(entity.id);
            expect(inventory).toBeDefined();
            expect(inventory?.buildingType).toBe(BuildingType.WoodcutterHut);
            // Woodcutter has LOG output slot
            expect(inventory?.outputSlots.length).toBeGreaterThan(0);
            expect(inventory?.outputSlots[0].materialType).toBe(EMaterialType.LOG);
        });

        it('should create inventory with input slots for processing buildings', () => {
            const entity = gameState.addEntity(EntityType.Building, BuildingType.Sawmill, 10, 10, 1);

            const inventory = gameLoop.inventoryManager.getInventory(entity.id);
            expect(inventory).toBeDefined();
            // Sawmill has LOG input and BOARD output
            expect(inventory?.inputSlots.length).toBeGreaterThan(0);
            expect(inventory?.inputSlots[0].materialType).toBe(EMaterialType.LOG);
            expect(inventory?.outputSlots[0].materialType).toBe(EMaterialType.BOARD);
        });
    });

    // ---------------------------------------------------------------------------
    // Entity Removal - Cleanup
    // ---------------------------------------------------------------------------

    describe('Entity Removal - Cleanup', () => {
        it('should remove service area when logistics building is removed', () => {
            const entity = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 1);

            // Verify service area exists
            expect(gameLoop.serviceAreaManager.getServiceArea(entity.id)).toBeDefined();

            // Remove building
            gameState.removeEntity(entity.id);

            // Service area should be cleaned up
            expect(gameLoop.serviceAreaManager.getServiceArea(entity.id)).toBeUndefined();
        });

        it('should remove inventory when building is removed', () => {
            const entity = gameState.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 10, 10, 1);

            // Verify inventory exists
            expect(gameLoop.inventoryManager.getInventory(entity.id)).toBeDefined();

            // Remove building
            gameState.removeEntity(entity.id);

            // Inventory should be cleaned up
            expect(gameLoop.inventoryManager.getInventory(entity.id)).toBeUndefined();
        });

        it('should remove carrier state when carrier unit is removed', () => {
            // Create a tavern first
            const tavern = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 1);

            // Create a carrier unit
            const carrier = gameState.addEntity(EntityType.Unit, UnitType.Carrier, 12, 12, 1);

            // Manually register carrier with manager (normally done by carrier assignment system)
            gameLoop.carrierManager.createCarrier(carrier.id, tavern.id);
            expect(gameLoop.carrierManager.hasCarrier(carrier.id)).toBe(true);

            // Remove carrier
            gameState.removeEntity(carrier.id);

            // Carrier state should be cleaned up
            expect(gameLoop.carrierManager.hasCarrier(carrier.id)).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // System Tick - Fatigue Recovery
    // ---------------------------------------------------------------------------

    describe('CarrierSystem Tick - Fatigue Recovery', () => {
        it('should recover fatigue for resting carriers', () => {
            // Create tavern
            const tavern = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 1);

            // Create carrier unit and register
            const carrierEntity = gameState.addEntity(EntityType.Unit, UnitType.Carrier, 10, 10, 1);
            gameLoop.carrierManager.createCarrier(carrierEntity.id, tavern.id);

            // Set carrier as fatigued and resting
            gameLoop.carrierManager.setFatigue(carrierEntity.id, 50);
            gameLoop.carrierManager.setStatus(carrierEntity.id, 4); // CarrierStatus.Resting

            const initialFatigue = gameLoop.carrierManager.getCarrier(carrierEntity.id)!.fatigue;

            // Tick the carrier system
            gameLoop.carrierSystem.tick(1.0); // 1 second

            const newFatigue = gameLoop.carrierManager.getCarrier(carrierEntity.id)!.fatigue;
            expect(newFatigue).toBeLessThan(initialFatigue);
        });
    });

    // ---------------------------------------------------------------------------
    // Carrier Registration (Tier 3 — migrated from e2e)
    // ---------------------------------------------------------------------------

    describe('Carrier Registration', () => {
        it('should register carrier with home building and no active job', () => {
            // Create a tavern (logistics hub with service area)
            const tavern = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 1);

            // Create a carrier unit near the tavern
            const carrier = gameState.addEntity(EntityType.Unit, UnitType.Carrier, 12, 12, 1);

            // Register carrier with the tavern
            gameLoop.carrierManager.createCarrier(carrier.id, tavern.id);

            const carrierState = gameLoop.carrierManager.getCarrier(carrier.id);
            expect(carrierState).toBeDefined();
            expect(carrierState!.homeBuilding).toBe(tavern.id);
            expect(carrierState!.currentJob).toBeNull();
        });
    });

    // ---------------------------------------------------------------------------
    // Resource Request Creation (Tier 3 — migrated from e2e)
    // ---------------------------------------------------------------------------

    describe('Resource Request Creation', () => {
        it('should create pending resource request with correct attributes', () => {
            // Create a sawmill (has LOG input slot)
            const sawmill = gameState.addEntity(EntityType.Building, BuildingType.Sawmill, 10, 10, 1);

            // Add a resource request for logs
            const request = gameLoop.requestManager.addRequest(
                sawmill.id,
                EMaterialType.LOG,
                4,
                RequestPriority.Normal
            );

            expect(request).toBeDefined();
            expect(request.materialType).toBe(EMaterialType.LOG);
            expect(request.amount).toBe(4);
            expect(request.status).toBe(RequestStatus.Pending);
            expect(request.buildingId).toBe(sawmill.id);
        });

        it('should track request in pending requests list', () => {
            const sawmill = gameState.addEntity(EntityType.Building, BuildingType.Sawmill, 10, 10, 1);

            gameLoop.requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);

            expect(gameLoop.requestManager.getPendingCount()).toBe(1);
            const pending = gameLoop.requestManager.getPendingRequests();
            expect(pending).toHaveLength(1);
            expect(pending[0].materialType).toBe(EMaterialType.LOG);
        });
    });

    // ---------------------------------------------------------------------------
    // Full Integration Scenario
    // ---------------------------------------------------------------------------

    describe('Full Integration Scenario', () => {
        it('should handle complete building lifecycle', () => {
            // 1. Create a tavern - should get service area
            const tavern = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 1);
            expect(gameLoop.serviceAreaManager.getServiceArea(tavern.id)).toBeDefined();

            // 2. Create a woodcutter - should get inventory
            const woodcutter = gameState.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 15, 10, 1);
            expect(gameLoop.inventoryManager.getInventory(woodcutter.id)).toBeDefined();

            // 3. Create a warehouse - StorageArea does NOT get a service area (it's not a carrier hub)
            const warehouse = gameState.addEntity(EntityType.Building, BuildingType.StorageArea, 20, 10, 1);
            expect(gameLoop.serviceAreaManager.getServiceArea(warehouse.id)).toBeUndefined();
            // Note: StorageArea has empty slot config - it uses dynamic material handling
            // so hasInventory() returns false and no traditional inventory is created

            // 4. Create a carrier and register it
            const carrier = gameState.addEntity(EntityType.Unit, UnitType.Carrier, 10, 10, 1);
            gameLoop.carrierManager.createCarrier(carrier.id, tavern.id);
            expect(gameLoop.carrierManager.getCarriersForTavern(tavern.id).length).toBe(1);

            // 5. Remove buildings and carrier - all should clean up
            gameState.removeEntity(tavern.id);
            gameState.removeEntity(woodcutter.id);
            gameState.removeEntity(warehouse.id);
            gameState.removeEntity(carrier.id);

            expect(gameLoop.serviceAreaManager.getServiceArea(tavern.id)).toBeUndefined();
            expect(gameLoop.serviceAreaManager.getServiceArea(warehouse.id)).toBeUndefined();
            expect(gameLoop.inventoryManager.getInventory(woodcutter.id)).toBeUndefined();
            expect(gameLoop.carrierManager.hasCarrier(carrier.id)).toBe(false);
        });
    });
});

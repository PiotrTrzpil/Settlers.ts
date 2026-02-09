/**
 * Tests for job completion handlers.
 */
/* eslint-disable max-lines-per-function */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    CarrierManager,
    CarrierStatus,
    type CarrierState,
    type CarrierJob,
    handleJobCompletion,
    handlePickupCompletion,
    handleDeliveryCompletion,
    handleReturnHomeCompletion,
} from '@/game/features/carriers';
import { BuildingInventoryManager } from '@/game/features/inventory';
import { BuildingType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { EventBus } from '@/game/event-bus';

describe('Job Completion Handlers', () => {
    let carrierManager: CarrierManager;
    let inventoryManager: BuildingInventoryManager;
    let eventBus: EventBus;

    beforeEach(() => {
        carrierManager = new CarrierManager();
        inventoryManager = new BuildingInventoryManager();
        eventBus = new EventBus();
        carrierManager.registerEvents(eventBus);
    });

    // Helper to create a carrier with a job
    function createCarrierWithJob(job: CarrierJob, status: CarrierStatus = CarrierStatus.Walking): CarrierState {
        const carrier = carrierManager.createCarrier(1, 100);
        carrier.currentJob = job;
        carrier.status = status;
        return carrier;
    }

    // ---------------------------------------------------------------------------
    // handlePickupCompletion
    // ---------------------------------------------------------------------------

    describe('handlePickupCompletion', () => {
        it('should withdraw material from source building and set carrier carrying state', () => {
            // Create a woodcutter with logs in output
            inventoryManager.createInventory(200, BuildingType.WoodcutterHut);
            inventoryManager.depositOutput(200, EMaterialType.LOG, 3);

            // Create carrier with pickup job
            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handlePickupCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300, // Destination building
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob?.type).toBe('deliver');

            // Carrier should be carrying the material
            const updatedCarrier = carrierManager.getCarrier(1)!;
            expect(updatedCarrier.carryingMaterial).toBe(EMaterialType.LOG);
            expect(updatedCarrier.carryingAmount).toBe(1);

            // Source building should have less material
            expect(inventoryManager.getOutputAmount(200, EMaterialType.LOG)).toBe(2);
        });

        it('should create deliver job to destination', () => {
            inventoryManager.createInventory(200, BuildingType.WoodcutterHut);
            inventoryManager.depositOutput(200, EMaterialType.LOG, 1);

            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handlePickupCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300,
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob).toEqual({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 1,
            });
        });

        it('should return home when material is no longer available', () => {
            // Create inventory with NO logs
            inventoryManager.createInventory(200, BuildingType.WoodcutterHut);

            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handlePickupCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.nextJob?.type).toBe('return_home');
            expect(result.error).toContain('no longer available');
        });

        it('should fail if carrier does not have a pickup job', () => {
            const carrier = createCarrierWithJob({ type: 'return_home' });

            const result = handlePickupCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('does not have a pickup job');
        });

        it('should emit carrier:pickupComplete event', () => {
            inventoryManager.createInventory(200, BuildingType.WoodcutterHut);
            inventoryManager.depositOutput(200, EMaterialType.LOG, 1);

            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const handler = vi.fn();
            eventBus.on('carrier:pickupComplete', handler);

            handlePickupCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300,
                eventBus,
            );

            expect(handler).toHaveBeenCalledWith({
                entityId: 1,
                material: EMaterialType.LOG,
                amount: 1,
                fromBuilding: 200,
            });
        });
    });

    // ---------------------------------------------------------------------------
    // handleDeliveryCompletion
    // ---------------------------------------------------------------------------

    describe('handleDeliveryCompletion', () => {
        it('should deposit material to destination building', () => {
            // Create a sawmill that accepts logs
            inventoryManager.createInventory(300, BuildingType.Sawmill);

            // Create carrier carrying logs
            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 2,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 2;

            const result = handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob?.type).toBe('return_home');

            // Destination should have the material
            expect(inventoryManager.getInputSlot(300, EMaterialType.LOG)?.currentAmount).toBe(2);
        });

        it('should clear carrier carrying state', () => {
            inventoryManager.createInventory(300, BuildingType.Sawmill);

            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 1,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 1;

            handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            const updatedCarrier = carrierManager.getCarrier(1)!;
            expect(updatedCarrier.carryingMaterial).toBeNull();
            expect(updatedCarrier.carryingAmount).toBe(0);
        });

        it('should create return_home job after delivery', () => {
            inventoryManager.createInventory(300, BuildingType.Sawmill);

            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 1,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 1;

            const result = handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            expect(result.nextJob).toEqual({ type: 'return_home' });
        });

        it('should handle partial delivery when destination is full', () => {
            // Create inventory and fill it almost to capacity
            inventoryManager.createInventory(300, BuildingType.Sawmill);
            const slot = inventoryManager.getInputSlot(300, EMaterialType.LOG);
            expect(slot).toBeDefined();

            // Fill slot to leave only 1 space
            const spaceLeft = 1;
            inventoryManager.depositInput(300, EMaterialType.LOG, slot!.maxCapacity - spaceLeft);

            // Try to deliver 3 logs
            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 3,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 3;

            const result = handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            // Should still succeed but with overflow
            expect(result.success).toBe(true);
            expect(slot!.currentAmount).toBe(slot!.maxCapacity);
        });

        it('should fail if carrier does not have a deliver job', () => {
            const carrier = createCarrierWithJob({ type: 'return_home' });

            const result = handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('does not have a deliver job');
        });

        it('should emit carrier:deliveryComplete event', () => {
            inventoryManager.createInventory(300, BuildingType.Sawmill);

            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 1,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 1;

            const handler = vi.fn();
            eventBus.on('carrier:deliveryComplete', handler);

            handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            expect(handler).toHaveBeenCalledWith({
                entityId: 1,
                material: EMaterialType.LOG,
                amount: 1,
                toBuilding: 300,
                overflow: 0,
            });
        });
    });

    // ---------------------------------------------------------------------------
    // handleReturnHomeCompletion
    // ---------------------------------------------------------------------------

    describe('handleReturnHomeCompletion', () => {
        it('should set carrier to idle status', () => {
            const carrier = createCarrierWithJob({ type: 'return_home' });

            const result = handleReturnHomeCompletion(
                carrier,
                carrierManager,
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob).toBeNull();

            const updatedCarrier = carrierManager.getCarrier(1)!;
            expect(updatedCarrier.status).toBe(CarrierStatus.Idle);
            expect(updatedCarrier.currentJob).toBeNull();
        });

        it('should fail if carrier does not have a return_home job', () => {
            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handleReturnHomeCompletion(
                carrier,
                carrierManager,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('does not have a return_home job');
        });

        it('should emit carrier:returnedHome event', () => {
            const carrier = createCarrierWithJob({ type: 'return_home' });

            const handler = vi.fn();
            eventBus.on('carrier:returnedHome', handler);

            handleReturnHomeCompletion(
                carrier,
                carrierManager,
                eventBus,
            );

            expect(handler).toHaveBeenCalledWith({
                entityId: 1,
                homeBuilding: 100,
            });
        });
    });

    // ---------------------------------------------------------------------------
    // Edge Cases: Building Destroyed
    // ---------------------------------------------------------------------------

    describe('building destroyed edge cases', () => {
        it('should handle pickup when source building is destroyed', () => {
            // Create carrier with pickup job pointing to non-existent building
            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 999, // Building doesn't exist
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handlePickupCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.nextJob?.type).toBe('return_home');
            expect(result.error).toContain('no inventory');
        });

        it('should handle delivery when destination building is destroyed', () => {
            // Create carrier with deliver job pointing to non-existent building
            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 999, // Building doesn't exist
                material: EMaterialType.LOG,
                amount: 1,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 1;

            const result = handleDeliveryCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.nextJob?.type).toBe('return_home');
            expect(result.error).toContain('no inventory');

            // Carrier should no longer be carrying goods (they're lost)
            const updatedCarrier = carrierManager.getCarrier(1)!;
            expect(updatedCarrier.carryingMaterial).toBeNull();
        });
    });

    // ---------------------------------------------------------------------------
    // handleJobCompletion (dispatcher)
    // ---------------------------------------------------------------------------

    describe('handleJobCompletion', () => {
        it('should dispatch to pickup handler for pickup jobs', () => {
            inventoryManager.createInventory(200, BuildingType.WoodcutterHut);
            inventoryManager.depositOutput(200, EMaterialType.LOG, 1);

            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handleJobCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                300, // destination
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob?.type).toBe('deliver');
        });

        it('should dispatch to delivery handler for deliver jobs', () => {
            inventoryManager.createInventory(300, BuildingType.Sawmill);

            const carrier = createCarrierWithJob({
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.LOG,
                amount: 1,
            });
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 1;

            const result = handleJobCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                undefined,
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob?.type).toBe('return_home');
        });

        it('should dispatch to return_home handler for return_home jobs', () => {
            const carrier = createCarrierWithJob({ type: 'return_home' });

            const result = handleJobCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                undefined,
                eventBus,
            );

            expect(result.success).toBe(true);
            expect(result.nextJob).toBeNull();
        });

        it('should fail if carrier has no job', () => {
            const carrier = carrierManager.createCarrier(1, 100);

            const result = handleJobCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                undefined,
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('no current job');
        });

        it('should require destinationBuildingId for pickup jobs', () => {
            const carrier = createCarrierWithJob({
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            const result = handleJobCompletion(
                carrier,
                carrierManager,
                inventoryManager,
                undefined, // Missing destination
                eventBus,
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('destinationBuildingId');
        });
    });
});

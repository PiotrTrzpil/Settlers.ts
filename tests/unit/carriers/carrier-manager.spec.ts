/**
 * Tests for CarrierManager - carrier state management.
 */
/* eslint-disable max-lines-per-function */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CarrierManager,
    CarrierStatus,
    type CarrierJob,
} from '@/game/features/carriers';
import { EMaterialType } from '@/game/economy';

describe('CarrierManager', () => {
    let manager: CarrierManager;

    beforeEach(() => {
        manager = new CarrierManager();
    });

    // ---------------------------------------------------------------------------
    // Carrier Creation/Removal
    // ---------------------------------------------------------------------------

    describe('createCarrier', () => {
        it('should create a carrier with default state', () => {
            const carrier = manager.createCarrier(1, 100);

            expect(carrier.entityId).toBe(1);
            expect(carrier.homeBuilding).toBe(100);
            expect(carrier.currentJob).toBeNull();
            expect(carrier.fatigue).toBe(0);
            expect(carrier.carryingMaterial).toBeNull();
            expect(carrier.carryingAmount).toBe(0);
            expect(carrier.status).toBe(CarrierStatus.Idle);
        });

        it('should register carrier in manager', () => {
            manager.createCarrier(1, 100);

            expect(manager.hasCarrier(1)).toBe(true);
            expect(manager.getCarrier(1)).toBeDefined();
        });

        it('should throw when creating carrier with duplicate entity ID', () => {
            manager.createCarrier(1, 100);

            expect(() => manager.createCarrier(1, 200)).toThrow(
                'Carrier with entity ID 1 already exists'
            );
        });

        it('should track carrier count', () => {
            expect(manager.size).toBe(0);

            manager.createCarrier(1, 100);
            expect(manager.size).toBe(1);

            manager.createCarrier(2, 100);
            expect(manager.size).toBe(2);
        });
    });

    describe('removeCarrier', () => {
        it('should remove an existing carrier', () => {
            manager.createCarrier(1, 100);

            const removed = manager.removeCarrier(1);

            expect(removed).toBe(true);
            expect(manager.hasCarrier(1)).toBe(false);
            expect(manager.getCarrier(1)).toBeUndefined();
        });

        it('should return false when removing non-existent carrier', () => {
            const removed = manager.removeCarrier(999);
            expect(removed).toBe(false);
        });

        it('should remove carrier from tavern index', () => {
            manager.createCarrier(1, 100);
            manager.removeCarrier(1);

            expect(manager.getCarriersForTavern(100)).toHaveLength(0);
        });

        it('should update carrier count', () => {
            manager.createCarrier(1, 100);
            manager.createCarrier(2, 100);
            expect(manager.size).toBe(2);

            manager.removeCarrier(1);
            expect(manager.size).toBe(1);
        });
    });

    // ---------------------------------------------------------------------------
    // Querying Carriers by Tavern
    // ---------------------------------------------------------------------------

    describe('getCarriersForTavern', () => {
        it('should return empty array for tavern with no carriers', () => {
            const carriers = manager.getCarriersForTavern(100);
            expect(carriers).toHaveLength(0);
        });

        it('should return all carriers for a tavern', () => {
            manager.createCarrier(1, 100);
            manager.createCarrier(2, 100);
            manager.createCarrier(3, 200); // Different tavern

            const carriers = manager.getCarriersForTavern(100);

            expect(carriers).toHaveLength(2);
            expect(carriers.map(c => c.entityId).sort()).toEqual([1, 2]);
        });

        it('should not include carriers from other taverns', () => {
            manager.createCarrier(1, 100);
            manager.createCarrier(2, 200);

            const carriers = manager.getCarriersForTavern(100);

            expect(carriers).toHaveLength(1);
            expect(carriers[0].entityId).toBe(1);
        });
    });

    describe('getAvailableCarriers', () => {
        it('should return only idle carriers without jobs', () => {
            manager.createCarrier(1, 100); // Will remain idle (available)
            const carrier2 = manager.createCarrier(2, 100);
            const carrier3 = manager.createCarrier(3, 100);

            // carrier2 is walking (has job)
            carrier2.status = CarrierStatus.Walking;
            carrier2.currentJob = { type: 'pickup', fromBuilding: 200, material: EMaterialType.LOG, amount: 1 };

            // carrier3 is resting
            carrier3.status = CarrierStatus.Resting;

            const available = manager.getAvailableCarriers(100);

            expect(available).toHaveLength(1);
            expect(available[0].entityId).toBe(1);
        });

        it('should return empty array when all carriers are busy', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.status = CarrierStatus.Walking;
            carrier.currentJob = { type: 'return_home' };

            const available = manager.getAvailableCarriers(100);
            expect(available).toHaveLength(0);
        });

        it('should only return carriers from specified tavern', () => {
            manager.createCarrier(1, 100);
            manager.createCarrier(2, 200);

            const available = manager.getAvailableCarriers(100);

            expect(available).toHaveLength(1);
            expect(available[0].homeBuilding).toBe(100);
        });
    });

    // ---------------------------------------------------------------------------
    // Job Assignment
    // ---------------------------------------------------------------------------

    describe('assignJob', () => {
        it('should assign pickup job to idle carrier', () => {
            manager.createCarrier(1, 100);

            const job: CarrierJob = {
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            };

            const assigned = manager.assignJob(1, job);

            expect(assigned).toBe(true);
            const carrier = manager.getCarrier(1)!;
            expect(carrier.currentJob).toEqual(job);
            expect(carrier.status).toBe(CarrierStatus.Walking);
        });

        it('should assign deliver job to idle carrier', () => {
            manager.createCarrier(1, 100);

            const job: CarrierJob = {
                type: 'deliver',
                toBuilding: 300,
                material: EMaterialType.BOARD,
                amount: 2,
            };

            const assigned = manager.assignJob(1, job);

            expect(assigned).toBe(true);
            const carrier = manager.getCarrier(1)!;
            expect(carrier.currentJob).toEqual(job);
        });

        it('should assign return_home job', () => {
            manager.createCarrier(1, 100);

            const job: CarrierJob = { type: 'return_home' };

            const assigned = manager.assignJob(1, job);

            expect(assigned).toBe(true);
            const carrier = manager.getCarrier(1)!;
            expect(carrier.currentJob).toEqual(job);
        });

        it('should not assign job to non-existent carrier', () => {
            const assigned = manager.assignJob(999, { type: 'return_home' });
            expect(assigned).toBe(false);
        });

        it('should not assign job to carrier that already has a job', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.currentJob = { type: 'return_home' };
            carrier.status = CarrierStatus.Walking;

            const assigned = manager.assignJob(1, {
                type: 'pickup',
                fromBuilding: 200,
                material: EMaterialType.LOG,
                amount: 1,
            });

            expect(assigned).toBe(false);
        });

        it('should not assign job to non-idle carrier', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.status = CarrierStatus.Resting;

            const assigned = manager.assignJob(1, { type: 'return_home' });

            expect(assigned).toBe(false);
        });
    });

    describe('completeJob', () => {
        it('should complete a job and return carrier to idle', () => {
            const carrier = manager.createCarrier(1, 100);
            manager.assignJob(1, { type: 'return_home' });

            const completed = manager.completeJob(1);

            expect(completed).toBe(true);
            expect(carrier.currentJob).toBeNull();
            expect(carrier.status).toBe(CarrierStatus.Idle);
        });

        it('should return false for non-existent carrier', () => {
            const completed = manager.completeJob(999);
            expect(completed).toBe(false);
        });

        it('should return false for carrier without job', () => {
            manager.createCarrier(1, 100);

            const completed = manager.completeJob(1);
            expect(completed).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Status and Carrying State
    // ---------------------------------------------------------------------------

    describe('setStatus', () => {
        it('should update carrier status', () => {
            const carrier = manager.createCarrier(1, 100);

            manager.setStatus(1, CarrierStatus.PickingUp);

            expect(carrier.status).toBe(CarrierStatus.PickingUp);
        });

        it('should return false for non-existent carrier', () => {
            const result = manager.setStatus(999, CarrierStatus.Walking);
            expect(result).toBe(false);
        });
    });

    describe('setCarrying', () => {
        it('should set carrying material and amount', () => {
            const carrier = manager.createCarrier(1, 100);

            manager.setCarrying(1, EMaterialType.STONE, 3);

            expect(carrier.carryingMaterial).toBe(EMaterialType.STONE);
            expect(carrier.carryingAmount).toBe(3);
        });

        it('should clear carrying when material is null', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.carryingMaterial = EMaterialType.LOG;
            carrier.carryingAmount = 5;

            manager.setCarrying(1, null, 0);

            expect(carrier.carryingMaterial).toBeNull();
            expect(carrier.carryingAmount).toBe(0);
        });

        it('should return false for non-existent carrier', () => {
            const result = manager.setCarrying(999, EMaterialType.LOG, 1);
            expect(result).toBe(false);
        });
    });

    describe('setFatigue', () => {
        it('should update fatigue level', () => {
            const carrier = manager.createCarrier(1, 100);

            manager.setFatigue(1, 50);

            expect(carrier.fatigue).toBe(50);
        });

        it('should clamp fatigue to 0-100 range', () => {
            const carrier = manager.createCarrier(1, 100);

            manager.setFatigue(1, 150);
            expect(carrier.fatigue).toBe(100);

            manager.setFatigue(1, -10);
            expect(carrier.fatigue).toBe(0);
        });

        it('should return false for non-existent carrier', () => {
            const result = manager.setFatigue(999, 50);
            expect(result).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Tavern Reassignment
    // ---------------------------------------------------------------------------

    describe('reassignToTavern', () => {
        it('should move carrier to a different tavern', () => {
            const carrier = manager.createCarrier(1, 100);

            const result = manager.reassignToTavern(1, 200);

            expect(result).toBe(true);
            expect(carrier.homeBuilding).toBe(200);
            expect(manager.getCarriersForTavern(100)).toHaveLength(0);
            expect(manager.getCarriersForTavern(200)).toHaveLength(1);
        });

        it('should return false for non-existent carrier', () => {
            const result = manager.reassignToTavern(999, 200);
            expect(result).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Iteration
    // ---------------------------------------------------------------------------

    describe('getAllCarriers', () => {
        it('should iterate over all carriers', () => {
            manager.createCarrier(1, 100);
            manager.createCarrier(2, 100);
            manager.createCarrier(3, 200);

            const allCarriers = [...manager.getAllCarriers()];

            expect(allCarriers).toHaveLength(3);
            expect(allCarriers.map(c => c.entityId).sort()).toEqual([1, 2, 3]);
        });

        it('should return empty iterator when no carriers', () => {
            const allCarriers = [...manager.getAllCarriers()];
            expect(allCarriers).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------------------
    // Clear
    // ---------------------------------------------------------------------------

    describe('clear', () => {
        it('should remove all carriers', () => {
            manager.createCarrier(1, 100);
            manager.createCarrier(2, 200);

            manager.clear();

            expect(manager.size).toBe(0);
            expect(manager.hasCarrier(1)).toBe(false);
            expect(manager.hasCarrier(2)).toBe(false);
            expect(manager.getCarriersForTavern(100)).toHaveLength(0);
            expect(manager.getCarriersForTavern(200)).toHaveLength(0);
        });
    });
});

/**
 * Tests for CarrierManager - carrier state management.
 */
/* eslint-disable max-lines-per-function */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CarrierManager,
    CarrierStatus,
    FatigueLevel,
    FATIGUE_THRESHOLDS,
    getFatigueLevel,
    canAcceptNewJob,
    type CarrierJob,
} from '@/game/features/carriers';
import { EMaterialType } from '@/game/economy';
import { EventBus } from '@/game/event-bus';
import { MockEntityProvider } from '../helpers/mock-entity-provider';

describe('CarrierManager', () => {
    let manager: CarrierManager;
    let entityProvider: MockEntityProvider;

    beforeEach(() => {
        manager = new CarrierManager();
        entityProvider = new MockEntityProvider();
        manager.setEntityProvider(entityProvider);
        manager.registerEvents(new EventBus());
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
        it('should return only idle carriers without jobs and low fatigue', () => {
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

        it('should exclude carriers with high fatigue (Exhausted or Collapsed)', () => {
            manager.createCarrier(1, 100); // Fresh, available
            const carrier2 = manager.createCarrier(2, 100);
            const carrier3 = manager.createCarrier(3, 100);

            carrier2.fatigue = FATIGUE_THRESHOLDS[FatigueLevel.Exhausted]; // Too tired
            carrier3.fatigue = FATIGUE_THRESHOLDS[FatigueLevel.Collapsed]; // Way too tired

            const available = manager.getAvailableCarriers(100);

            expect(available).toHaveLength(1);
            expect(available[0].entityId).toBe(1);
        });

        it('should include carriers with moderate fatigue (Tired)', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = FATIGUE_THRESHOLDS[FatigueLevel.Tired]; // Tired but can work

            const available = manager.getAvailableCarriers(100);

            expect(available).toHaveLength(1);
        });
    });

    describe('getBusyCarriers', () => {
        it('should return carriers with active jobs', () => {
            manager.createCarrier(1, 100); // Idle
            const carrier2 = manager.createCarrier(2, 100);
            carrier2.currentJob = { type: 'return_home' };

            const busy = manager.getBusyCarriers(100);

            expect(busy).toHaveLength(1);
            expect(busy[0].entityId).toBe(2);
        });

        it('should return carriers that are not idle', () => {
            manager.createCarrier(1, 100); // Idle
            const carrier2 = manager.createCarrier(2, 100);
            carrier2.status = CarrierStatus.Resting;

            const busy = manager.getBusyCarriers(100);

            expect(busy).toHaveLength(1);
            expect(busy[0].entityId).toBe(2);
        });
    });

    // ---------------------------------------------------------------------------
    // Job Assignment
    // ---------------------------------------------------------------------------

    describe('canAssignJobTo', () => {
        it('should return true for idle carrier with no job and low fatigue', () => {
            manager.createCarrier(1, 100);
            expect(manager.canAssignJobTo(1)).toBe(true);
        });

        it('should return false for non-existent carrier', () => {
            expect(manager.canAssignJobTo(999)).toBe(false);
        });

        it('should return false for carrier with job', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.currentJob = { type: 'return_home' };

            expect(manager.canAssignJobTo(1)).toBe(false);
        });

        it('should return false for non-idle carrier', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.status = CarrierStatus.Resting;

            expect(manager.canAssignJobTo(1)).toBe(false);
        });

        it('should return false for exhausted carrier', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = FATIGUE_THRESHOLDS[FatigueLevel.Exhausted];

            expect(manager.canAssignJobTo(1)).toBe(false);
        });

        it('should return true for tired carrier', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = FATIGUE_THRESHOLDS[FatigueLevel.Tired];

            expect(manager.canAssignJobTo(1)).toBe(true);
        });
    });

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
            // Note: assignJob does NOT change status - caller controls status
            expect(carrier.status).toBe(CarrierStatus.Idle);
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

        it('should not assign job to exhausted carrier', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = FATIGUE_THRESHOLDS[FatigueLevel.Exhausted];

            const assigned = manager.assignJob(1, { type: 'return_home' });

            expect(assigned).toBe(false);
        });
    });

    describe('completeJob', () => {
        it('should complete a job and return the completed job', () => {
            const carrier = manager.createCarrier(1, 100);
            const job: CarrierJob = { type: 'return_home' };
            carrier.currentJob = job;

            const completedJob = manager.completeJob(1);

            expect(completedJob).toEqual(job);
            expect(carrier.currentJob).toBeNull();
            // Note: completeJob does NOT change status - caller controls status
        });

        it('should return null for carrier without job', () => {
            manager.createCarrier(1, 100);

            const completed = manager.completeJob(1);
            expect(completed).toBeNull();
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

        it('should no-op when status is already the same', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.status = CarrierStatus.Walking;

            manager.setStatus(1, CarrierStatus.Walking);

            expect(carrier.status).toBe(CarrierStatus.Walking);
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

    });

    describe('addFatigue', () => {
        it('should add fatigue to carrier', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = 30;

            manager.addFatigue(1, 20);

            expect(carrier.fatigue).toBe(50);
        });

        it('should subtract fatigue when amount is negative', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = 50;

            manager.addFatigue(1, -20);

            expect(carrier.fatigue).toBe(30);
        });

        it('should clamp result to valid range', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.fatigue = 90;

            manager.addFatigue(1, 50);
            expect(carrier.fatigue).toBe(100);

            manager.addFatigue(1, -200);
            expect(carrier.fatigue).toBe(0);
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

        it('should return true when already at target tavern', () => {
            const carrier = manager.createCarrier(1, 100);

            const result = manager.reassignToTavern(1, 100);

            expect(result).toBe(true);
            expect(carrier.homeBuilding).toBe(100);
        });

        it('should prevent reassignment when carrier has active job', () => {
            const carrier = manager.createCarrier(1, 100);
            carrier.currentJob = { type: 'return_home' };

            const result = manager.reassignToTavern(1, 200);

            expect(result).toBe(false);
            expect(carrier.homeBuilding).toBe(100);
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

    // ---------------------------------------------------------------------------
    // Error Handling - Optimistic Programming
    // ---------------------------------------------------------------------------

    describe('error handling', () => {
        it('should throw when operating on non-existent carrier', () => {
            // All mutation methods should throw for entities without carrier state
            expect(() => manager.completeJob(999)).toThrow(/is not a carrier/);
            expect(() => manager.setStatus(999, CarrierStatus.Walking)).toThrow(/is not a carrier/);
            expect(() => manager.setCarrying(999, EMaterialType.LOG, 1)).toThrow(/is not a carrier/);
            expect(() => manager.setFatigue(999, 50)).toThrow(/is not a carrier/);
            expect(() => manager.addFatigue(999, 10)).toThrow(/is not a carrier/);
            expect(() => manager.reassignToTavern(999, 200)).toThrow(/is not a carrier/);
        });
    });
});

// ---------------------------------------------------------------------------
// Fatigue Level Functions
// ---------------------------------------------------------------------------

describe('Fatigue Level Functions', () => {
    describe('getFatigueLevel', () => {
        it('should return Fresh for fatigue 0-25', () => {
            expect(getFatigueLevel(0)).toBe(FatigueLevel.Fresh);
            expect(getFatigueLevel(25)).toBe(FatigueLevel.Fresh);
        });

        it('should return Tired for fatigue 26-50', () => {
            expect(getFatigueLevel(26)).toBe(FatigueLevel.Tired);
            expect(getFatigueLevel(50)).toBe(FatigueLevel.Tired);
        });

        it('should return Exhausted for fatigue 51-75', () => {
            expect(getFatigueLevel(51)).toBe(FatigueLevel.Exhausted);
            expect(getFatigueLevel(75)).toBe(FatigueLevel.Exhausted);
        });

        it('should return Collapsed for fatigue 76-100', () => {
            expect(getFatigueLevel(76)).toBe(FatigueLevel.Collapsed);
            expect(getFatigueLevel(100)).toBe(FatigueLevel.Collapsed);
        });
    });

    describe('canAcceptNewJob', () => {
        it('should return true for Fresh fatigue', () => {
            expect(canAcceptNewJob(0)).toBe(true);
            expect(canAcceptNewJob(25)).toBe(true);
        });

        it('should return true for Tired fatigue', () => {
            expect(canAcceptNewJob(26)).toBe(true);
            expect(canAcceptNewJob(50)).toBe(true);
        });

        it('should return false for Exhausted fatigue', () => {
            expect(canAcceptNewJob(51)).toBe(false);
            expect(canAcceptNewJob(75)).toBe(false);
        });

        it('should return false for Collapsed fatigue', () => {
            expect(canAcceptNewJob(76)).toBe(false);
            expect(canAcceptNewJob(100)).toBe(false);
        });
    });
});

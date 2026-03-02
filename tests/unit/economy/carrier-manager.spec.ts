/**
 * Tests for CarrierManager - carrier state management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CarrierManager, CarrierStatus } from '@/game/features/carriers';
import { EventBus } from '@/game/event-bus';
import { MockEntityProvider } from '../helpers/mock-entity-provider';

describe('CarrierManager', () => {
    let manager: CarrierManager;
    let entityProvider: MockEntityProvider;
    let eventBus: EventBus;

    beforeEach(() => {
        entityProvider = new MockEntityProvider();
        eventBus = new EventBus();
        manager = new CarrierManager({
            entityProvider,
            eventBus,
        });
    });

    // ---------------------------------------------------------------------------
    // Carrier Registration/Removal
    // ---------------------------------------------------------------------------

    describe('registerCarrier', () => {
        it('should create a carrier with default state', () => {
            const carrier = manager.registerCarrier(1);

            expect(carrier.entityId).toBe(1);
            expect(carrier.status).toBe(CarrierStatus.Idle);
        });

        it('should register carrier in manager', () => {
            manager.registerCarrier(1);

            expect(manager.hasCarrier(1)).toBe(true);
            expect(manager.getCarrier(1)).toBeDefined();
        });

        it('should throw when creating carrier with duplicate entity ID', () => {
            manager.registerCarrier(1);

            expect(() => manager.registerCarrier(1)).toThrow('Carrier with entity ID 1 already exists');
        });

        it('should track carrier count', () => {
            expect(manager.size).toBe(0);

            manager.registerCarrier(1);
            expect(manager.size).toBe(1);

            manager.registerCarrier(2);
            expect(manager.size).toBe(2);
        });
    });

    describe('removeCarrier', () => {
        it('should remove an existing carrier', () => {
            manager.registerCarrier(1);

            const removed = manager.removeCarrier(1);

            expect(removed).toBe(true);
            expect(manager.hasCarrier(1)).toBe(false);
            expect(manager.getCarrier(1)).toBeUndefined();
        });

        it('should return false when removing non-existent carrier', () => {
            const removed = manager.removeCarrier(999);
            expect(removed).toBe(false);
        });

        it('should update carrier count', () => {
            manager.registerCarrier(1);
            manager.registerCarrier(2);
            expect(manager.size).toBe(2);

            manager.removeCarrier(1);
            expect(manager.size).toBe(1);
        });
    });

    // ---------------------------------------------------------------------------
    // Carrier Availability
    // ---------------------------------------------------------------------------

    describe('canAssignJobTo', () => {
        it('should return true for idle carrier', () => {
            manager.registerCarrier(1);
            expect(manager.canAssignJobTo(1)).toBe(true);
        });

        it('should return false for non-existent carrier', () => {
            expect(manager.canAssignJobTo(999)).toBe(false);
        });

        it('should return false for non-idle carrier', () => {
            manager.registerCarrier(1);
            manager.setStatus(1, CarrierStatus.Walking);

            expect(manager.canAssignJobTo(1)).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------------

    describe('setStatus', () => {
        it('should update carrier status', () => {
            const carrier = manager.registerCarrier(1);

            manager.setStatus(1, CarrierStatus.PickingUp);

            expect(carrier.status).toBe(CarrierStatus.PickingUp);
        });

        it('should no-op when status is already the same', () => {
            const carrier = manager.registerCarrier(1);
            manager.setStatus(1, CarrierStatus.Walking);

            manager.setStatus(1, CarrierStatus.Walking);

            expect(carrier.status).toBe(CarrierStatus.Walking);
        });
    });

    // ---------------------------------------------------------------------------
    // Iteration
    // ---------------------------------------------------------------------------

    describe('getAllCarriers', () => {
        it('should iterate over all carriers', () => {
            manager.registerCarrier(1);
            manager.registerCarrier(2);
            manager.registerCarrier(3);

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
            manager.registerCarrier(1);
            manager.registerCarrier(2);

            manager.clear();

            expect(manager.size).toBe(0);
            expect(manager.hasCarrier(1)).toBe(false);
            expect(manager.hasCarrier(2)).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Error Handling - Optimistic Programming
    // ---------------------------------------------------------------------------

    describe('error handling', () => {
        it('should throw when operating on non-existent carrier', () => {
            expect(() => manager.setStatus(999, CarrierStatus.Walking)).toThrow(/is not a carrier/);
        });
    });
});

// @vitest-environment jsdom
/**
 * Unit tests for TransportJobService — stateless lifecycle operations
 * for TransportJobRecord (reservation, request status, and inventory operations).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as TransportJobService from '@/game/features/logistics/transport-job-service';
import { resetTransportJobIds } from '@/game/features/logistics/transport-job-service';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import { RequestManager } from '@/game/features/logistics/request-manager';
import { InventoryReservationManager } from '@/game/features/logistics/inventory-reservation';
import { EMaterialType } from '@/game/economy';
import { RequestPriority, RequestStatus } from '@/game/features/logistics';
import type { BuildingInventoryManager } from '@/game/features/inventory';
import { EventBus } from '@/game/event-bus';
import type { TransportJobDeps } from '@/game/features/logistics/transport-job-service';
import { InFlightTrackerImpl } from '@/game/features/logistics/in-flight-tracker';

// ─── Minimal BuildingInventoryManager stub ──────────────────────────

function createInventoryStub(outputAmount = 5) {
    const slots = new Map<string, { current: number; reserved: number }>();

    function key(buildingId: number, material: EMaterialType) {
        return `${buildingId}:${material}`;
    }

    function getOrCreate(buildingId: number, material: EMaterialType) {
        const k = key(buildingId, material);
        if (!slots.has(k)) {
            slots.set(k, { current: outputAmount, reserved: 0 });
        }
        return slots.get(k)!;
    }

    return {
        reserveOutput(buildingId: number, material: EMaterialType, amount: number): number {
            const slot = getOrCreate(buildingId, material);
            const available = slot.current - slot.reserved;
            const reserved = Math.min(amount, available);
            slot.reserved += reserved;
            return reserved;
        },
        releaseOutputReservation(buildingId: number, material: EMaterialType, amount: number): void {
            const slot = getOrCreate(buildingId, material);
            slot.reserved = Math.max(0, slot.reserved - amount);
        },
        getBuildingsWithOutput: () => [],
        getInventory: () => undefined,
        getSlot,
        _slots: slots,
    };

    function getSlot(buildingId: number, material: EMaterialType) {
        return slots.get(key(buildingId, material));
    }
}

// ─── Test setup ─────────────────────────────────────────────────────

describe('TransportJobService', () => {
    let requestManager: RequestManager;
    let reservationManager: InventoryReservationManager;
    let inventoryManager: ReturnType<typeof createInventoryStub>;
    let eventBus: EventBus;
    let deps: TransportJobDeps;

    const SOURCE = 100;
    const DEST = 200;
    const CARRIER = 1;
    const MATERIAL = EMaterialType.LOG;

    beforeEach(() => {
        resetTransportJobIds();
        eventBus = new EventBus();
        requestManager = new RequestManager(eventBus);
        inventoryManager = createInventoryStub(5);
        reservationManager = new InventoryReservationManager(inventoryManager as unknown as BuildingInventoryManager);
        deps = { reservationManager, requestManager, eventBus, inFlightTracker: new InFlightTrackerImpl() };
    });

    function addRequest() {
        return requestManager.addRequest(DEST, MATERIAL, 1, RequestPriority.Normal);
    }

    function createRecord(request = addRequest()): TransportJobRecord | null {
        return TransportJobService.activate(request.id, SOURCE, DEST, MATERIAL, 1, CARRIER, deps);
    }

    // ─── activate ───────────────────────────────────────────────────

    describe('activate', () => {
        it('reserves inventory and marks request InProgress', () => {
            const request = addRequest();
            const record = createRecord(request);

            expect(record).not.toBeNull();
            expect(record!.phase).toBe(TransportPhase.Reserved);
            expect(record!.sourceBuilding).toBe(SOURCE);
            expect(record!.destBuilding).toBe(DEST);
            expect(record!.material).toBe(MATERIAL);
            expect(record!.amount).toBe(1);

            // Request should be InProgress
            expect(request.status).toBe(RequestStatus.InProgress);
            expect(request.assignedCarrier).toBe(CARRIER);
            expect(request.sourceBuilding).toBe(SOURCE);

            // Reservation should exist
            expect(reservationManager.size).toBe(1);
        });

        it('returns null if reservation fails (no inventory)', () => {
            inventoryManager = createInventoryStub(0);
            reservationManager = new InventoryReservationManager(
                inventoryManager as unknown as BuildingInventoryManager
            );
            deps = { reservationManager, requestManager, eventBus, inFlightTracker: new InFlightTrackerImpl() };

            const request = addRequest();
            const record = TransportJobService.activate(request.id, SOURCE, DEST, MATERIAL, 1, CARRIER, deps);

            expect(record).toBeNull();
            // Request should still be Pending (not assigned)
            expect(request.status).toBe(RequestStatus.Pending);
        });
    });

    // ─── pickUp ─────────────────────────────────────────────────────

    describe('pickUp', () => {
        it('transitions to picked-up and consumes reservation', () => {
            const record = createRecord()!;

            TransportJobService.pickUp(record, deps);

            expect(record.phase).toBe(TransportPhase.PickedUp);
            // Reservation bookkeeping should be cleaned up
            expect(reservationManager.size).toBe(0);
        });

        it('throws if called when not Reserved', () => {
            const record = createRecord()!;
            TransportJobService.pickUp(record, deps);

            expect(() => TransportJobService.pickUp(record, deps)).toThrow(/picked-up/);
        });

        it('throws if called when cancelled', () => {
            const record = createRecord()!;
            TransportJobService.cancel(record, 'cancelled', deps);

            expect(() => TransportJobService.pickUp(record, deps)).toThrow(/cancelled/);
        });
    });

    // ─── deliver ────────────────────────────────────────────────────

    describe('deliver', () => {
        it('fulfills the request after pickup', () => {
            const request = addRequest();
            const record = createRecord(request)!;
            TransportJobService.pickUp(record, deps);

            TransportJobService.deliver(record, deps);

            // Request should be fulfilled (removed from manager)
            expect(requestManager.getRequest(request.id)).toBeUndefined();
        });

        it('throws if called when still Reserved (not picked up)', () => {
            const record = createRecord()!;

            expect(() => TransportJobService.deliver(record, deps)).toThrow(/reserved/);
        });

        it('throws if called when cancelled', () => {
            const record = createRecord()!;
            TransportJobService.cancel(record, 'cancelled', deps);

            expect(() => TransportJobService.deliver(record, deps)).toThrow(/cancelled/);
        });
    });

    // ─── cancel ─────────────────────────────────────────────────────

    describe('cancel', () => {
        it('releases reservation and resets request when reserved', () => {
            const request = addRequest();
            const record = createRecord(request)!;

            TransportJobService.cancel(record, 'cancelled', deps);

            expect(record.phase).toBe(TransportPhase.Cancelled);
            expect(reservationManager.size).toBe(0);
            expect(request.status).toBe(RequestStatus.Pending);
        });

        it('resets request when picked-up (no reservation to release)', () => {
            const request = addRequest();
            const record = createRecord(request)!;
            TransportJobService.pickUp(record, deps);

            TransportJobService.cancel(record, 'cancelled', deps);

            expect(record.phase).toBe(TransportPhase.Cancelled);
            // Request was InProgress, now reset to Pending
            expect(request.status).toBe(RequestStatus.Pending);
        });

        it('is a no-op if already cancelled', () => {
            const record = createRecord()!;
            TransportJobService.cancel(record, 'cancelled', deps);
            TransportJobService.cancel(record, 'cancelled', deps); // second call should be fine

            expect(record.phase).toBe(TransportPhase.Cancelled);
        });
    });
});

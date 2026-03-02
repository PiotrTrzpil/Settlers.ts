// @vitest-environment jsdom
/**
 * Unit tests for TransportJob — the single object that owns a carrier transport's
 * reservation, request status, and inventory operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TransportJob, resetTransportJobIds } from '@/game/features/logistics/transport-job';
import { RequestManager } from '@/game/features/logistics/request-manager';
import { InventoryReservationManager } from '@/game/features/logistics/inventory-reservation';
import { EMaterialType } from '@/game/economy';
import { RequestPriority, RequestStatus } from '@/game/features/logistics';
import type { BuildingInventoryManager } from '@/game/features/inventory';

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
        withdrawReservedOutput(buildingId: number, material: EMaterialType, amount: number): number {
            const slot = getOrCreate(buildingId, material);
            const withdrawn = Math.min(amount, slot.reserved, slot.current);
            slot.current -= withdrawn;
            slot.reserved -= withdrawn;
            return withdrawn;
        },
        depositInput(_buildingId: number, _material: EMaterialType, amount: number): number {
            return amount; // Accept all
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

type InventoryStub = ReturnType<typeof createInventoryStub>;

// ─── Test setup ─────────────────────────────────────────────────────

describe('TransportJob', () => {
    let requestManager: RequestManager;
    let reservationManager: InventoryReservationManager;
    let inventoryManager: InventoryStub;

    const SOURCE = 100;
    const DEST = 200;
    const HOME = 300;
    const CARRIER = 1;
    const MATERIAL = EMaterialType.LOG;

    beforeEach(() => {
        resetTransportJobIds();
        requestManager = new RequestManager();
        reservationManager = new InventoryReservationManager();
        inventoryManager = createInventoryStub(5);
        reservationManager.setInventoryManager(inventoryManager as unknown as BuildingInventoryManager);
    });

    function addRequest() {
        return requestManager.addRequest(DEST, MATERIAL, 1, RequestPriority.Normal);
    }

    function createJob(request = addRequest()) {
        return TransportJob.create(request.id, SOURCE, DEST, MATERIAL, 1, HOME, CARRIER, {
            reservationManager,
            requestManager,
            inventoryManager: inventoryManager as unknown as BuildingInventoryManager,
        });
    }

    // ─── Creation ───────────────────────────────────────────────────

    describe('create', () => {
        it('reserves inventory and marks request InProgress', () => {
            const request = addRequest();
            const job = createJob(request);

            expect(job).not.toBeNull();
            expect(job!.status).toBe('active');
            expect(job!.sourceBuilding).toBe(SOURCE);
            expect(job!.destBuilding).toBe(DEST);
            expect(job!.material).toBe(MATERIAL);
            expect(job!.amount).toBe(1);
            expect(job!.homeBuilding).toBe(HOME);

            // Request should be InProgress
            expect(request.status).toBe(RequestStatus.InProgress);
            expect(request.assignedCarrier).toBe(CARRIER);
            expect(request.sourceBuilding).toBe(SOURCE);

            // Reservation should exist
            expect(reservationManager.size).toBe(1);
        });

        it('returns null if reservation fails (no inventory)', () => {
            inventoryManager = createInventoryStub(0);
            reservationManager = new InventoryReservationManager();
            reservationManager.setInventoryManager(inventoryManager as unknown as BuildingInventoryManager);

            const request = addRequest();
            const job = TransportJob.create(request.id, SOURCE, DEST, MATERIAL, 1, HOME, CARRIER, {
                reservationManager,
                requestManager,
                inventoryManager: inventoryManager as unknown as BuildingInventoryManager,
            });

            expect(job).toBeNull();
            // Request should still be Pending (not assigned)
            expect(request.status).toBe(RequestStatus.Pending);
        });
    });

    // ─── Pickup ─────────────────────────────────────────────────────

    describe('pickup', () => {
        it('withdraws reserved inventory and transitions to picked-up', () => {
            const job = createJob()!;

            const withdrawn = job.pickup();

            expect(withdrawn).toBe(1);
            expect(job.status).toBe('picked-up');
            // Reservation bookkeeping should be cleaned up
            expect(reservationManager.size).toBe(0);
        });

        it('returns 0 and cancels job if withdrawal fails', () => {
            const request = addRequest();
            const job = createJob(request)!;

            // Drain the inventory so withdrawal fails
            const slot = inventoryManager.getSlot(SOURCE, MATERIAL)!;
            slot.current = 0;
            slot.reserved = 0;

            const withdrawn = job.pickup();

            expect(withdrawn).toBe(0);
            expect(job.status).toBe('cancelled');
            // Request should be reset to Pending
            expect(request.status).toBe(RequestStatus.Pending);
        });

        it('is a no-op if called twice', () => {
            const job = createJob()!;
            job.pickup();
            const second = job.pickup();

            expect(second).toBe(0);
            expect(job.status).toBe('picked-up');
        });
    });

    // ─── Complete ───────────────────────────────────────────────────

    describe('complete', () => {
        it('deposits and fulfills the request', () => {
            const request = addRequest();
            const job = createJob(request)!;
            job.pickup();

            const deposited = job.complete(1);

            expect(deposited).toBe(1);
            expect(job.status).toBe('completed');
            // Request should be fulfilled (removed from manager)
            expect(requestManager.getRequest(request.id)).toBeUndefined();
        });

        it('is a no-op if not in picked-up state', () => {
            const job = createJob()!;
            // Still 'active' — haven't picked up yet
            const deposited = job.complete(1);

            expect(deposited).toBe(0);
            expect(job.status).toBe('active');
        });
    });

    // ─── Cancel ─────────────────────────────────────────────────────

    describe('cancel', () => {
        it('releases reservation and resets request when active', () => {
            const request = addRequest();
            const job = createJob(request)!;

            job.cancel('timeout');

            expect(job.status).toBe('cancelled');
            expect(reservationManager.size).toBe(0);
            expect(request.status).toBe(RequestStatus.Pending);
        });

        it('resets request when picked-up (no reservation to release)', () => {
            const request = addRequest();
            const job = createJob(request)!;
            job.pickup();

            job.cancel('carrier_removed');

            expect(job.status).toBe('cancelled');
            // Request was InProgress, now reset to Pending
            expect(request.status).toBe(RequestStatus.Pending);
        });

        it('is a no-op if already completed', () => {
            const request = addRequest();
            const job = createJob(request)!;
            job.pickup();
            job.complete(1);

            job.cancel(); // should be a no-op

            expect(job.status).toBe('completed');
        });

        it('is a no-op if already cancelled', () => {
            const job = createJob()!;
            job.cancel('timeout');
            job.cancel('carrier_removed'); // second call should be fine

            expect(job.status).toBe('cancelled');
        });
    });
});

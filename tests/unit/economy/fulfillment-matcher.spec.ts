import { describe, it, expect, beforeEach } from 'vitest';
import { RequestManager, RequestPriority, RequestStatus, InventoryReservationManager } from '@/game/features/logistics';
import { EMaterialType } from '@/game/economy/material-type';

describe('RequestManager state machine', () => {
    let requestManager: RequestManager;

    beforeEach(() => {
        requestManager = new RequestManager();
    });

    it('request lifecycle: Pending → InProgress → Fulfilled (removed)', () => {
        const request = requestManager.addRequest(100, EMaterialType.LOG, 5, RequestPriority.Normal);
        expect(request.status).toBe(RequestStatus.Pending);

        const assigned = requestManager.assignRequest(request.id, 200, 300);
        expect(assigned).toBe(true);
        expect(request.status).toBe(RequestStatus.InProgress);
        expect(request.sourceBuilding).toBe(200);
        expect(request.assignedCarrier).toBe(300);

        // Cannot re-assign
        expect(requestManager.assignRequest(request.id, 201, 301)).toBe(false);
        // Cannot fulfill while pending (test a fresh request)
        const r2 = requestManager.addRequest(101, EMaterialType.STONE, 1);
        expect(requestManager.fulfillRequest(r2.id)).toBe(false);

        const fulfilled = requestManager.fulfillRequest(request.id);
        expect(fulfilled).toBe(true);
        expect(requestManager.getRequest(request.id)).toBeUndefined();
    });

    it('getPendingRequests sorts by priority then timestamp', () => {
        const low = requestManager.addRequest(100, EMaterialType.LOG, 1, RequestPriority.Low);
        const high = requestManager.addRequest(101, EMaterialType.STONE, 1, RequestPriority.High);
        const normal = requestManager.addRequest(102, EMaterialType.BOARD, 1, RequestPriority.Normal);

        const pending = requestManager.getPendingRequests();
        expect(pending.map(r => r.id)).toEqual([high.id, normal.id, low.id]);
    });

    it('cancelRequestsForBuilding removes all requests for that building', () => {
        requestManager.addRequest(100, EMaterialType.LOG, 1);
        requestManager.addRequest(100, EMaterialType.STONE, 2);
        requestManager.addRequest(101, EMaterialType.BOARD, 3);

        expect(requestManager.cancelRequestsForBuilding(100)).toBe(2);
        expect(requestManager.getPendingCount()).toBe(1);
    });
});

describe('InventoryReservationManager', () => {
    let reservationManager: InventoryReservationManager;

    beforeEach(() => {
        const mockInventoryManager = {
            reserveOutput: (_buildingId: number, _material: number, amount: number) => amount,
            releaseOutputReservation: () => {},
        } as unknown as import('@/game/features/inventory').BuildingInventoryManager;
        reservationManager = new InventoryReservationManager(mockInventoryManager);
    });

    it('tracks reserved amounts per building+material and computes available correctly', () => {
        reservationManager.createReservation(100, EMaterialType.LOG, 5, 1);
        reservationManager.createReservation(100, EMaterialType.LOG, 3, 2);
        reservationManager.createReservation(100, EMaterialType.STONE, 2, 3);

        expect(reservationManager.getReservedAmount(100, EMaterialType.LOG)).toBe(8);
        expect(reservationManager.getReservedAmount(100, EMaterialType.STONE)).toBe(2);
        expect(reservationManager.getAvailableAmount(100, EMaterialType.LOG, 10)).toBe(2);
        // Does not go below zero
        expect(reservationManager.getAvailableAmount(100, EMaterialType.LOG, 5)).toBe(0);
    });

    it('releases reservations by ID, request ID, or building', () => {
        const r1 = reservationManager.createReservation(100, EMaterialType.LOG, 5, 1)!;
        reservationManager.createReservation(100, EMaterialType.STONE, 3, 2);
        reservationManager.createReservation(101, EMaterialType.LOG, 7, 3);

        // Release by request ID
        expect(reservationManager.releaseReservationForRequest(r1.requestId)).toBe(true);
        expect(reservationManager.getReservedAmount(100, EMaterialType.LOG)).toBe(0);

        // Release by building
        expect(reservationManager.releaseReservationsForBuilding(100)).toBe(1); // STONE left
        expect(reservationManager.size).toBe(1); // only building 101 remains

        // Release by request ID
        expect(reservationManager.releaseReservationForRequest(3)).toBe(true);
        expect(reservationManager.size).toBe(0);
    });

    it('rejects zero or negative amounts', () => {
        expect(reservationManager.createReservation(100, EMaterialType.LOG, 0, 1)).toBeNull();
        expect(reservationManager.createReservation(100, EMaterialType.LOG, -5, 2)).toBeNull();
    });
});

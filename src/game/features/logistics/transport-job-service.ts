/**
 * TransportJobService — stateless lifecycle operations for TransportJobRecord.
 *
 * Extracted 1:1 from TransportJob + RequestFulfillment classes.
 * Each method takes a record and deps as parameters — no stored state.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { InventoryReservationManager } from './inventory-reservation';
import type { RequestManager, RequestResetReason } from './request-manager';
import type { EventBus } from '../../event-bus';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import type { InFlightTracker } from './in-flight-tracker';

export interface TransportJobDeps {
    reservationManager: InventoryReservationManager;
    requestManager: RequestManager;
    eventBus: EventBus;
    inFlightTracker: InFlightTracker;
}

let nextJobId = 1;

/**
 * Activate a new transport job: reserve inventory, mark request InProgress, return record.
 *
 * @returns The record with phase=Reserved, or null if reservation failed.
 */
export function activate(
    requestId: number,
    sourceBuilding: number,
    destBuilding: number,
    material: EMaterialType,
    amount: number,
    carrierId: number,
    deps: TransportJobDeps
): TransportJobRecord | null {
    const reservation = deps.reservationManager.createReservation(sourceBuilding, material, amount, requestId);
    if (!reservation) return null;

    deps.requestManager.assignRequest(requestId, sourceBuilding, carrierId);

    const record: TransportJobRecord = {
        id: nextJobId++,
        requestId,
        sourceBuilding,
        destBuilding,
        material,
        amount: reservation.amount,
        carrierId,
        phase: TransportPhase.Reserved,
    };
    return record;
}

/**
 * Consume the slot-level reservation after the carrier picks up material.
 * Asserts phase===Reserved.
 */
export function pickUp(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.Reserved) {
        throw new Error(`TransportJobService.pickUp: expected phase 'reserved', got '${record.phase}'`);
    }
    deps.reservationManager.consumeReservationForRequest(record.requestId);
    deps.inFlightTracker.recordPickup(record.destBuilding, record.material, record.amount);
    record.phase = TransportPhase.PickedUp;
}

/**
 * Mark the transport request as fulfilled after the carrier delivers material.
 * Asserts phase===PickedUp.
 */
export function deliver(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.PickedUp) {
        throw new Error(`TransportJobService.deliver: expected phase 'picked-up', got '${record.phase}'`);
    }
    deps.requestManager.fulfillRequest(record.requestId);
    deps.inFlightTracker.recordResolved(record.destBuilding, record.material, record.amount);
    record.phase = TransportPhase.Delivered;
}

/**
 * Cancel a transport job. Releases reservation if still reserved, resets request to pending.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function cancel(record: TransportJobRecord, reason: RequestResetReason, deps: TransportJobDeps): void {
    if (record.phase === TransportPhase.Cancelled || record.phase === TransportPhase.Delivered) {
        return;
    }
    if (record.phase === TransportPhase.Reserved) {
        deps.reservationManager.releaseReservationForRequest(record.requestId);
    }
    if (record.phase === TransportPhase.PickedUp) {
        deps.inFlightTracker.recordResolved(record.destBuilding, record.material, record.amount);
    }
    deps.requestManager.resetRequest(record.requestId, reason);
    record.phase = TransportPhase.Cancelled;
    deps.eventBus.emit('carrier:transportCancelled', {
        carrierId: record.carrierId,
        requestId: record.requestId,
        reason,
    });
}

/**
 * Redirect the source building of a transport job (e.g., when the original source is destroyed
 * and materials are moved to a free pile).
 *
 * @returns true if the reservation was successfully transferred, false otherwise.
 */
export function redirectSource(record: TransportJobRecord, newBuildingId: number, deps: TransportJobDeps): boolean {
    const transferred = deps.reservationManager.transferReservation(record.requestId, newBuildingId);
    if (transferred) {
        record.sourceBuilding = newBuildingId;
    }
    return transferred;
}

/** Reset the job ID counter (for testing). */
export function resetTransportJobIds(): void {
    nextJobId = 1;
}

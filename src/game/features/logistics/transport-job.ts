/**
 * TransportJob - Owns the full lifecycle of a single carrier transport.
 *
 * Encapsulates reservation, request status, and inventory operations
 * into a single object. Every TransportJob that is constructed will
 * eventually have exactly one of complete() or cancel() called.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { BuildingInventoryManager } from '../inventory';
import type { InventoryReservationManager } from './inventory-reservation';
import type { RequestManager, RequestResetReason } from './request-manager';
import type { EventBus } from '../../event-bus';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('TransportJob');

export type TransportJobStatus = 'active' | 'picked-up' | 'completed' | 'cancelled';

export interface TransportJobDeps {
    reservationManager: InventoryReservationManager;
    requestManager: RequestManager;
    inventoryManager: BuildingInventoryManager;
    eventBus: EventBus;
}

let nextJobId = 1;

export class TransportJob {
    readonly id: number;
    readonly requestId: number;
    /** Source building (or free pile) entity ID. Updated by redirectSource() when building is destroyed. */
    sourceBuilding: number;
    readonly destBuilding: number;
    readonly material: EMaterialType;
    readonly amount: number;
    readonly reservationId: number;
    readonly carrierId: number;

    private _status: TransportJobStatus = 'active';
    private readonly deps: TransportJobDeps;

    get status(): TransportJobStatus {
        return this._status;
    }

    /**
     * Create a TransportJob. Reserves inventory and marks the request InProgress.
     *
     * @returns The job, or null if reservation failed.
     */
    static create(
        requestId: number,
        sourceBuilding: number,
        destBuilding: number,
        material: EMaterialType,
        amount: number,
        carrierId: number,
        deps: TransportJobDeps
    ): TransportJob | null {
        // Reserve inventory at source
        const reservation = deps.reservationManager.createReservation(sourceBuilding, material, amount, requestId);
        if (!reservation) {
            return null;
        }

        // Mark request as in-progress
        deps.requestManager.assignRequest(requestId, sourceBuilding, carrierId);

        return new TransportJob(
            requestId,
            sourceBuilding,
            destBuilding,
            material,
            reservation.amount,
            reservation.id,
            carrierId,
            deps
        );
    }

    private constructor(
        requestId: number,
        sourceBuilding: number,
        destBuilding: number,
        material: EMaterialType,
        amount: number,
        reservationId: number,
        carrierId: number,
        deps: TransportJobDeps
    ) {
        this.id = nextJobId++;
        this.requestId = requestId;
        this.sourceBuilding = sourceBuilding;
        this.destBuilding = destBuilding;
        this.material = material;
        this.amount = amount;
        this.reservationId = reservationId;
        this.carrierId = carrierId;
        this.deps = deps;
    }

    /**
     * Pick up material from the source building.
     * Atomically releases the slot reservation and withdraws inventory.
     *
     * @returns Amount withdrawn (0 = failed).
     */
    pickup(): number {
        if (this._status !== 'active') {
            log.warn(`TransportJob #${this.id}: pickup() called in status '${this._status}', ignoring`);
            return 0;
        }

        const withdrawn = this.deps.inventoryManager.withdrawReservedOutput(
            this.sourceBuilding,
            this.material,
            this.amount
        );

        if (withdrawn === 0) {
            // Pickup failed — cancel the job (releases reservation-manager bookkeeping)
            this.cancelInternal('pickup_failed');
            return 0;
        }

        this._status = 'picked-up';
        // Slot-level reservation was consumed by withdrawReservedOutput.
        // Remove the reservation-manager bookkeeping (it's no longer needed).
        this.deps.reservationManager.releaseReservationForRequest(this.requestId);
        return withdrawn;
    }

    /**
     * Deposit material at the destination building and fulfill the request.
     *
     * @returns Amount deposited.
     */
    complete(actualAmount: number): number {
        if (this._status !== 'picked-up') {
            log.warn(`TransportJob #${this.id}: complete() called in status '${this._status}', ignoring`);
            return 0;
        }

        const deposited = this.deps.inventoryManager.depositInput(this.destBuilding, this.material, actualAmount);
        this.deps.requestManager.fulfillRequest(this.requestId);
        this._status = 'completed';
        return deposited;
    }

    /**
     * Cancel this transport job. Releases reservation and resets request to pending.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    cancel(reason: RequestResetReason = 'cancelled'): void {
        if (this._status === 'completed' || this._status === 'cancelled') {
            return;
        }
        this.cancelInternal(reason);
    }

    private cancelInternal(reason: RequestResetReason): void {
        // If we haven't picked up yet, release the reservation
        if (this._status === 'active') {
            this.deps.reservationManager.releaseReservationForRequest(this.requestId);
        }
        // Reset request back to pending so it can be reassigned
        this.deps.requestManager.resetRequest(this.requestId, reason);
        this._status = 'cancelled';

        // Notify listeners so LogisticsDispatcher.activeJobs can be cleaned up
        // regardless of which path triggered the cancellation.
        this.deps.eventBus.emit('carrier:transportCancelled', {
            carrierId: this.carrierId,
            requestId: this.requestId,
            reason,
        });
    }
}

/** Reset the job ID counter (for testing). */
export function resetTransportJobIds(): void {
    nextJobId = 1;
}

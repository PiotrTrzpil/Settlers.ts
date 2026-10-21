/**
 * TransportJobService — stateless lifecycle operations for TransportJobRecord.
 *
 * Each method takes a record and deps as parameters — no stored state.
 * The store owns record lifetime: terminal transitions (deliver, cancel)
 * remove the record here, in one place. No destination slot is reserved —
 * over-ordering is prevented by demand deficit accounting, and the actual
 * landing slot is resolved at delivery time.
 */

import { EMaterialType } from '../../economy/material-type';
import type { EventBus } from '../../event-bus';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import type { TransportJobStore } from './transport-job-store';
import type { DemandLedger } from './demand-ledger';
import type { BuildingInventoryManager } from '../inventory';
import { JobKind } from '../../systems/choreo';
import type { JobService } from '../settler-tasks';

/** The part of the job runtime a record cancel needs: stop the carrier's running Transport job. */
export type TransportJobControl = Pick<JobService, 'cancel'>;

export interface TransportJobDeps {
    jobStore: TransportJobStore;
    demandLedger: DemandLedger;
    eventBus: EventBus;
    inventoryManager: BuildingInventoryManager;
    jobs: TransportJobControl;
}

/**
 * Activate a new transport job: verify available supply and create the record.
 *
 * @param queued - true for a follow-up job pre-assigned to a busy carrier;
 *   the record starts at phase=Queued and is promoted when the carrier
 *   finishes its current delivery (LogisticsDispatcher.flushQueuedAssignment).
 * @returns The record, or null if the source's unreserved supply is insufficient.
 */
export function activate(
    sourceBuilding: number,
    destBuilding: number,
    material: EMaterialType,
    amount: number,
    carrierId: number,
    deps: TransportJobDeps,
    options?: { queued?: boolean }
): TransportJobRecord | null {
    const currentAmount = deps.inventoryManager.getOutputAmount(sourceBuilding, material);
    const available = deps.jobStore.getAvailableSupply(sourceBuilding, material, currentAmount);
    if (available < amount) {
        return null;
    }

    const record: TransportJobRecord = {
        id: deps.jobStore.allocateId(),
        sourceBuilding,
        destBuilding,
        material,
        amount,
        carrierId,
        phase: options?.queued ? TransportPhase.Queued : TransportPhase.Reserved,
        createdAt: deps.demandLedger.getGameTime(),
    };

    deps.jobStore.add(record);
    return record;
}

/**
 * Promote a queued follow-up job to active (Reserved) — the carrier finished
 * its previous delivery and the choreography is about to be assigned.
 */
export function promoteQueued(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.Queued) {
        throw new Error(`TransportJobService.promoteQueued: expected phase 'queued', got '${record.phase}'`);
    }
    record.phase = TransportPhase.Reserved;
    deps.jobStore.reindex(record.id);
}

/**
 * Advance phase from Reserved → PickedUp.
 *
 * Does NOT withdraw inventory — the TRANSPORT_PICKUP executor handles material
 * movement via MaterialTransfer.pickUpOutput() immediately after this call. This
 * separation ensures material is withdrawn exactly once and the carrier's
 * entity.carrying is set atomically with the withdrawal.
 */
export function pickUp(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.Reserved) {
        throw new Error(`TransportJobService.pickUp: expected phase 'reserved', got '${record.phase}'`);
    }
    record.phase = TransportPhase.PickedUp;
    deps.jobStore.reindex(record.id);
}

/**
 * Mark the transport job as delivered, remove it from the store, and emit
 * the fulfillment event. Asserts phase===PickedUp.
 *
 * Does NOT end the carrier's job — the choreography is still running (delivery
 * animation / stand-up); the carrier becomes free when its job completes.
 */
export function deliver(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.PickedUp) {
        throw new Error(`TransportJobService.deliver: expected phase 'picked-up', got '${record.phase}'`);
    }
    record.phase = TransportPhase.Delivered;
    deps.jobStore.remove(record.id);
    deps.eventBus.emit('logistics:demandFulfilled', {
        buildingId: record.destBuilding,
        materialType: record.material,
    });
}

/**
 * Cancel a transport job: remove the record and, for an active (non-queued) record, stop the
 * carrier's running Transport job (`jobs.cancel` — owner-initiated, so the Transport handler is
 * not called back). Safe to call multiple times — subsequent calls are no-ops. The deficit
 * re-opens automatically on the next dispatch tick.
 *
 * Queued follow-ups never owned the running job, so cancelling one leaves the carrier alone.
 */
export function cancel(record: TransportJobRecord, reason: string, deps: TransportJobDeps): void {
    const wasActive = record.phase === TransportPhase.Reserved || record.phase === TransportPhase.PickedUp;
    discard(record, reason, deps);
    if (wasActive) {
        deps.jobs.cancel(record.carrierId, JobKind.Transport);
    }
}

/**
 * Remove a record whose carrier no longer runs it — its job already ended (Transport handler
 * onFailed / onUnitRemoved) or was never restored (orphan on load). Idempotent like `cancel`.
 * Emits `carrier:transportCancelled` for active records — a notification only (timeline, tests).
 */
export function discard(record: TransportJobRecord, reason: string, deps: TransportJobDeps): void {
    if (record.phase === TransportPhase.Cancelled || record.phase === TransportPhase.Delivered) {
        return;
    }
    const wasQueued = record.phase === TransportPhase.Queued;
    record.phase = TransportPhase.Cancelled;
    deps.jobStore.remove(record.id);
    if (!wasQueued) {
        deps.eventBus.emit('carrier:transportCancelled', {
            unitId: record.carrierId,
            jobId: record.id,
            reason,
            level: 'warn',
        });
    }
}

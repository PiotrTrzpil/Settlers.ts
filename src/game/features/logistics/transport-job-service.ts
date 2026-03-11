/**
 * TransportJobService — stateless lifecycle operations for TransportJobRecord.
 *
 * Each method takes a record and deps as parameters — no stored state.
 * TransportJobStore is the single source of truth; no separate reservation manager,
 * in-flight tracker, or request manager.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { EventBus } from '../../event-bus';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import type { TransportJobStore } from './transport-job-store';
import type { DemandQueue } from './demand-queue';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';

export interface TransportJobDeps {
    jobStore: TransportJobStore;
    demandQueue: DemandQueue;
    eventBus: EventBus;
    inventoryManager: BuildingInventoryManager;
}

/**
 * Activate a new transport job: verify available supply, create record at phase=Reserved,
 * add to job store, consume demand. Returns the record or null if supply is insufficient.
 *
 * @param options.skipStore - If true, the record is NOT added to the job store. Use this for
 *   pre-assigned (queued) jobs where the carrier is still busy delivering another job.
 *   The caller is responsible for adding the record to the store later (via flushQueuedAssignment).
 */
export function activate(
    demandId: number,
    sourceBuilding: number,
    destBuilding: number,
    material: EMaterialType,
    amount: number,
    carrierId: number,
    deps: TransportJobDeps,
    options?: { skipStore?: boolean }
): TransportJobRecord | null {
    const currentAmount = deps.inventoryManager.getOutputAmount(sourceBuilding, material);
    const available = deps.jobStore.getAvailableSupply(sourceBuilding, material, currentAmount);
    if (available < amount) return null;

    const record: TransportJobRecord = {
        id: deps.jobStore.allocateJobId(),
        demandId,
        sourceBuilding,
        destBuilding,
        material,
        amount,
        carrierId,
        phase: TransportPhase.Reserved,
        createdAt: deps.demandQueue.getGameTime(),
    };

    if (!options?.skipStore) {
        deps.jobStore.jobs.set(carrierId, record);
    }
    deps.demandQueue.consumeDemand(demandId);

    return record;
}

/**
 * Advance phase from Reserved → PickedUp.
 *
 * Does NOT withdraw inventory — the choreography handles material movement
 * via MaterialTransfer.pickUp() immediately after this call. This separation
 * ensures material is withdrawn exactly once and the carrier's entity.carrying
 * is set atomically with the withdrawal.
 */
export function pickUp(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.Reserved) {
        throw new Error(`TransportJobService.pickUp: expected phase 'reserved', got '${record.phase}'`);
    }
    record.phase = TransportPhase.PickedUp;
    deps.jobStore.jobs.reindex(record.carrierId);
}

/**
 * Mark the transport job as delivered and emit the fulfillment event.
 * Asserts phase===PickedUp.
 */
export function deliver(record: TransportJobRecord, deps: TransportJobDeps): void {
    if (record.phase !== TransportPhase.PickedUp) {
        throw new Error(`TransportJobService.deliver: expected phase 'picked-up', got '${record.phase}'`);
    }
    record.phase = TransportPhase.Delivered;
    deps.jobStore.jobs.reindex(record.carrierId);
    deps.eventBus.emit('logistics:demandFulfilled', {
        demandId: record.demandId,
        buildingId: record.destBuilding,
        materialType: record.material,
    });
}

/**
 * Cancel a transport job. Safe to call multiple times — subsequent calls are no-ops.
 * The demand will be re-created automatically by scanners on the next tick.
 */
export function cancel(record: TransportJobRecord, reason: string, deps: TransportJobDeps): void {
    if (record.phase === TransportPhase.Cancelled || record.phase === TransportPhase.Delivered) {
        return;
    }
    record.phase = TransportPhase.Cancelled;
    // Only reindex if the record is in the active jobs map (not pending reservations)
    if (deps.jobStore.jobs.has(record.carrierId)) {
        deps.jobStore.jobs.reindex(record.carrierId);
    }
    deps.eventBus.emit('carrier:transportCancelled', {
        unitId: record.carrierId,
        requestId: record.demandId,
        reason,
        level: 'warn',
    });
}

/**
 * Redirect the source building of a transport job (e.g., when the original source is
 * destroyed and materials are moved to a free pile). Always succeeds.
 *
 * @returns true always (redirect just updates the field)
 */
export function redirectSource(record: TransportJobRecord, newBuildingId: number, deps: TransportJobDeps): boolean {
    record.sourceBuilding = newBuildingId;
    deps.jobStore.jobs.reindex(record.carrierId);
    return true;
}

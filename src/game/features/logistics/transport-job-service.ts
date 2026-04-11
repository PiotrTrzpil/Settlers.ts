/**
 * TransportJobService — stateless lifecycle operations for TransportJobRecord.
 *
 * Each method takes a record and deps as parameters — no stored state.
 * TransportJobStore is the single source of truth; no separate reservation manager,
 * in-flight tracker, or request manager.
 */

import { clearJobId, EntityType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import type { EventBus } from '../../event-bus';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import type { TransportJobStore } from './transport-job-store';
import type { DemandQueue } from './demand-queue';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { GameState } from '../../game-state';
import { SlotKind } from '../../core/pile-kind';

export interface TransportJobDeps {
    jobStore: TransportJobStore;
    demandQueue: DemandQueue;
    eventBus: EventBus;
    inventoryManager: BuildingInventoryManager;
    gameState: GameState;
}

/**
 * Resolve a destination slot for a transport job.
 *
 * Tries slot kinds in order: Storage (with claim-on-demand), Input.
 * Regular buildings have only Input slots, StorageAreas have only Storage slots,
 * so the first matching kind wins without needing a building type check.
 * Free piles / non-building entities use their first (and only) pile slot.
 *
 * Returns the slot ID, or -1 if no slot is available.
 */
function resolveDestinationSlot(destBuilding: number, material: EMaterialType, deps: TransportJobDeps): number {
    const entity = deps.gameState.getEntityOrThrow(destBuilding, 'transport job destination building');
    // Non-building entities (free piles) use their first (and only) pile slot.
    if (entity.type !== EntityType.Building) {
        const slots = deps.inventoryManager.getSlots(destBuilding);
        const first = slots.values().next().value;
        return first !== undefined ? first.id : 0;
    }

    const im = deps.inventoryManager;

    // Storage slots: find already-claimed slot with space, or claim a free one
    const claimed = im.findSlot(destBuilding, material, SlotKind.Storage);
    if (claimed !== undefined) {
        return claimed.id;
    }
    const free = im.findSlot(destBuilding, EMaterialType.NO_MATERIAL, SlotKind.Storage);
    if (free !== undefined) {
        im.setSlotMaterial(free.id, material);
        return free.id;
    }

    // Input slots: find a typed slot with space (accounts for reservations via findSlot)
    const input = im.findSlot(destBuilding, material, SlotKind.Input);
    if (input !== undefined) {
        return input.id;
    }

    return -1;
}

/**
 * Activate a new transport job: verify available supply, resolve destination slot,
 * create record at phase=Reserved, add to job store, consume demand.
 * Returns the record or null if supply is insufficient or no destination slot available.
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
    if (available < amount) {
        return null;
    }

    // Resolve destination slot — atomic with source reservation
    const slotId = resolveDestinationSlot(destBuilding, material, deps);
    if (slotId === -1) {
        return null;
    }

    const record: TransportJobRecord = {
        id: deps.gameState.allocateJobId(),
        demandId,
        sourceBuilding,
        destBuilding,
        material,
        amount,
        carrierId,
        slotId,
        phase: TransportPhase.Reserved,
        createdAt: deps.demandQueue.getGameTime(),
    };

    deps.inventoryManager.reserveSlot(slotId, record.id, carrierId, amount);

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
    deps.inventoryManager.unreserveSlot(record.slotId, record.id);
    record.phase = TransportPhase.Delivered;
    deps.jobStore.jobs.reindex(record.carrierId);
    // Do NOT clearJobId here — the carrier's choreography task is still running its
    // delivery animation. Clearing jobId makes the carrier appear idle, allowing
    // recruitment to grab it mid-task. jobId is cleared on settler:taskCompleted instead.
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
    deps.inventoryManager.unreserveSlot(record.slotId, record.id);
    record.phase = TransportPhase.Cancelled;
    // Only reindex if the record is in the active jobs map (not pending reservations)
    if (deps.jobStore.jobs.has(record.carrierId)) {
        deps.jobStore.jobs.reindex(record.carrierId);
    }
    const carrier = deps.gameState.getEntityOrThrow(record.carrierId, 'TransportJobService.cancel');
    clearJobId(carrier);
    deps.eventBus.emit('carrier:transportCancelled', {
        unitId: record.carrierId,
        requestId: record.demandId,
        reason,
        level: 'warn',
    });
}

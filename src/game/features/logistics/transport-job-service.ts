/**
 * TransportJobService — stateless lifecycle operations for TransportJobRecord.
 *
 * Each method takes a record and deps as parameters — no stored state.
 * TransportJobStore is the single source of truth; no separate reservation manager,
 * in-flight tracker, or request manager.
 */

import { BuildingType, EntityType } from '../../entity';
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
 * Resolve a destination slot for a regular (non-storage) building.
 * Finds an input slot with space for this material.
 * Returns slot ID or -1 if none available.
 */
function resolveRegularBuildingSlot(
    destBuilding: number,
    material: EMaterialType,
    inventoryManager: BuildingInventoryManager
): number {
    const slot = inventoryManager.findSlot(destBuilding, material, SlotKind.Input);
    return slot !== undefined ? slot.id : -1;
}

/**
 * Resolve a destination slot for a StorageArea.
 * First finds an already-claimed slot with space, then claims a free (NO_MATERIAL) slot.
 * Returns slot ID or -1 if no slot is available.
 */
function resolveStorageAreaSlot(
    destBuilding: number,
    material: EMaterialType,
    inventoryManager: BuildingInventoryManager
): number {
    // First: find already-claimed slot with space
    const claimed = inventoryManager.findSlot(destBuilding, material, SlotKind.Storage);
    if (claimed !== undefined) {
        return claimed.id;
    }

    // Then: claim a free (unclaimed) slot
    const free = inventoryManager.findSlot(destBuilding, EMaterialType.NO_MATERIAL, SlotKind.Storage);
    if (free !== undefined) {
        inventoryManager.setSlotMaterial(free.id, material);
        return free.id;
    }

    return -1;
}

/**
 * Resolve a destination slot for a transport job.
 *
 * - Regular buildings: find a typed input slot with space.
 * - StorageArea: find a claimed storage slot with space, or claim a free (NO_MATERIAL) slot.
 * - Free piles / non-building entities: return first slot ID (or 0 as fallback).
 *
 * Returns the slot ID, or -1 if no slot is available.
 */
function resolveDestinationSlot(destBuilding: number, material: EMaterialType, deps: TransportJobDeps): number {
    const entity = deps.gameState.getEntity(destBuilding);
    // Free piles and non-building entities use their first (and only) pile slot.
    if (!entity || entity.type !== EntityType.Building) {
        const slots = deps.inventoryManager.getSlots(destBuilding);
        const first = slots.values().next().value;
        return first !== undefined ? first.id : 0;
    }

    if ((entity.subType as BuildingType) === BuildingType.StorageArea) {
        return resolveStorageAreaSlot(destBuilding, material, deps.inventoryManager);
    }

    return resolveRegularBuildingSlot(destBuilding, material, deps.inventoryManager);
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
        id: deps.jobStore.allocateJobId(),
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

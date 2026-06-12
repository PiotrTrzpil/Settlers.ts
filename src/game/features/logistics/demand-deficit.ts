/**
 * Demand deficit derivation — how many units a standing order is short.
 *
 * deficit = min(target, deliverable space) − incoming
 *
 * where `incoming` is the amount already headed to the building (Queued,
 * Reserved, or PickedUp transport jobs). Capacity-kind orders (target=null)
 * simply fill available slot space. Everything is derived at read time, so
 * cancelled jobs or consumed inventory automatically re-open the deficit.
 *
 * Storage areas share unclaimed (NO_MATERIAL) slots between materials, so the
 * free-slot capacity counted for one material is reduced by other materials'
 * incoming overflow — otherwise every import-enabled material would claim the
 * same free slots and the building would be over-ordered.
 */

import { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { BuildingInventoryManager } from '../inventory';
import { isIncoming } from './transport-job-record';
import type { TransportJobStore } from './transport-job-store';
import type { DemandTarget } from './demand-ledger';

/**
 * Space a delivery of `material` could physically land in at this building,
 * accounting for material already incoming to shared storage slots:
 * - free capacity in matching Input slots
 * - free capacity in matching (claimed) Storage slots
 * - capacity of unclaimed Storage slots, minus other materials' incoming
 *   amounts that exceed their own claimed-slot space (they will claim free
 *   slots on delivery)
 */
export function deliverySpace(
    inventoryManager: BuildingInventoryManager,
    jobStore: TransportJobStore,
    buildingId: number,
    material: EMaterialType
): number {
    let space = 0;
    let freeCapacity = 0;
    const claimedSpaceByMaterial = new Map<EMaterialType, number>();

    for (const slot of inventoryManager.getSlots(buildingId)) {
        if (slot.kind === SlotKind.Input && slot.materialType === material) {
            space += slot.maxCapacity - slot.currentAmount;
        } else if (slot.kind === SlotKind.Storage) {
            if (slot.materialType === EMaterialType.NO_MATERIAL) {
                freeCapacity += slot.maxCapacity;
            } else {
                const prev = claimedSpaceByMaterial.get(slot.materialType);
                claimedSpaceByMaterial.set(
                    slot.materialType,
                    (prev === undefined ? 0 : prev) + slot.maxCapacity - slot.currentAmount
                );
            }
        }
    }

    const claimedSpace = claimedSpaceByMaterial.get(material);
    if (claimedSpace !== undefined) {
        space += claimedSpace;
    }

    if (freeCapacity > 0) {
        space += Math.max(
            0,
            freeCapacity - foreignFreeSlotClaims(jobStore, buildingId, material, claimedSpaceByMaterial)
        );
    }

    return space;
}

/**
 * Amount of free-slot capacity other materials' incoming jobs will claim:
 * for each other material, incoming beyond its own claimed-slot space spills
 * into unclaimed storage slots.
 */
function foreignFreeSlotClaims(
    jobStore: TransportJobStore,
    buildingId: number,
    material: EMaterialType,
    claimedSpaceByMaterial: ReadonlyMap<EMaterialType, number>
): number {
    const incomingByMaterial = new Map<EMaterialType, number>();
    for (const jobId of jobStore.byBuilding.get(buildingId)) {
        const job = jobStore.get(jobId);
        if (!job) {
            throw new Error(`No job for id ${jobId} in foreignFreeSlotClaims`);
        }
        if (job.destBuilding !== buildingId || job.material === material || !isIncoming(job.phase)) {
            continue;
        }
        const prev = incomingByMaterial.get(job.material);
        incomingByMaterial.set(job.material, (prev === undefined ? 0 : prev) + job.amount);
    }

    let claims = 0;
    for (const [otherMaterial, incoming] of incomingByMaterial) {
        const ownSpace = claimedSpaceByMaterial.get(otherMaterial);
        claims += Math.max(0, incoming - (ownSpace === undefined ? 0 : ownSpace));
    }
    return claims;
}

/** Units still to order for a standing order. 0 when satisfied. */
export function computeDeficit(
    entry: DemandTarget,
    inventoryManager: BuildingInventoryManager,
    jobStore: TransportJobStore
): number {
    const space = deliverySpace(inventoryManager, jobStore, entry.buildingId, entry.materialType);
    const wanted = entry.target === null ? space : Math.min(entry.target, space);
    const incoming = jobStore.getIncomingAmount(entry.buildingId, entry.materialType);
    const deficit = Math.min(wanted - incoming, entry.maxIncoming - incoming);
    return Math.max(0, deficit);
}

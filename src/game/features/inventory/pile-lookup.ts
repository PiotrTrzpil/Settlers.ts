/**
 * Pile lookup — "which pile of material M does building B use on side S?"
 *
 * Pile tiles are decided once, when slots are created (see pile-position-resolver.ts),
 * and stored on PileSlot.position. Runtime consumers (worker pile walks, carrier pickup)
 * ask this lookup for the slot and read its position — they never re-derive tiles.
 *
 * Side semantics (relative to the building):
 *   - Input:  the Input slot for M (production inputs, construction piles — first pile
 *             when a material is split over several). Storage slots are bidirectional,
 *             so a storage pile currently holding M also counts.
 *   - Output: the Output slot for M (production outputs, fixed even while empty), or a
 *             storage / free pile currently holding M.
 *
 * Storage and free slots only count while they hold stock: an empty storage slot is
 * not "the pile of M" (it may be re-claimed for another material).
 */

import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { PileSlot } from './pile-slot';

/** Which side of a building's inventory a pile lookup targets. */
export type PileSide = SlotKind.Input | SlotKind.Output;

function holdsStock(slot: PileSlot, material: EMaterialType): boolean {
    return slot.materialType === material && slot.currentAmount > 0;
}

function isSharedPile(slot: PileSlot, side: PileSide): boolean {
    return slot.kind === SlotKind.Storage || (side === SlotKind.Output && slot.kind === SlotKind.Free);
}

/**
 * Find the pile slot for (material, side) among one building's slots (in creation order).
 * Dedicated slots of the requested side win over shared storage/free piles.
 */
export function findPileSlot(
    slots: readonly PileSlot[],
    material: EMaterialType,
    side: PileSide
): PileSlot | undefined {
    const dedicated = slots.find(s => s.kind === side && s.materialType === material);
    if (dedicated) {
        return dedicated;
    }
    return slots.find(s => isSharedPile(s, side) && holdsStock(s, material));
}

/** Like findPileSlot, but the pile must exist — throws with the building's slot layout. */
export function requirePileSlot(
    slots: readonly PileSlot[],
    buildingId: number,
    material: EMaterialType,
    side: PileSide
): PileSlot {
    const slot = findPileSlot(slots, material, side);
    if (!slot) {
        const layout = slots.map(s => `${s.kind}:${s.materialType}x${s.currentAmount}`).join(', ');
        throw new Error(`Building ${buildingId} has no ${side} pile for ${material}. Slots: [${layout}]`);
    }
    return slot;
}

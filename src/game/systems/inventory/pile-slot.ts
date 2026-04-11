/**
 * PileSlot — unified inventory + pile data model.
 *
 * Merges the old InventorySlot (data) with PileRegistry (entity mapping)
 * and PilePositionResolver (position) into one flat record.
 *
 * A building's inventory = Map<slotId, PileSlot>.
 * Free piles are standalone PileSlots with kind='free' and buildingId=null.
 */

import type { Tile } from '../../core/coordinates';
import type { EMaterialType } from '../../economy/material-type';
import type { SlotKind } from '../../core/pile-kind';

/** A pending delivery reservation against a slot — tracks who reserved how much capacity. */
export interface SlotReservation {
    /** Globally unique job ID (entity.jobId). Primary key — unique per job, stable across save/load. */
    readonly jobId: number;
    /** Carrier entity ID (for restore: find which carrier owns this reservation). */
    readonly carrierId: number;
    /** Amount reserved. */
    readonly amount: number;
}

/**
 * A single inventory-pile slot. Holds material data, pile entity reference,
 * and world position. Slot IDs are stable across the lifetime of a game session.
 */
export interface PileSlot {
    /** Stable slot identifier — unique across all slots in the game. */
    readonly id: number;
    /** The material this slot holds (or NO_MATERIAL for unclaimed storage slots). */
    materialType: EMaterialType;
    /** Current amount of material (0..maxCapacity). */
    currentAmount: number;
    /** Maximum capacity (typically SLOT_CAPACITY = 8). */
    maxCapacity: number;
    /** World tile position where the pile entity is placed. */
    position: Tile;
    /** Pile entity ID (created when amount > 0, removed when amount reaches 0). null = no entity. */
    entityId: number | null;
    /** Slot purpose: output/input/construction/storage/free. */
    kind: SlotKind;
    /** Owning building entity ID. null for free piles. */
    buildingId: number | null;
    /**
     * Active delivery reservations — transport jobs that have been assigned to
     * deposit into this slot but haven't delivered yet. Used by findSlot to
     * avoid over-assigning capacity when multiple slots exist for one material.
     */
    reservations: SlotReservation[];
}

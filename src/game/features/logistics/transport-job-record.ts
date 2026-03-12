/**
 * TransportJobRecord — flat, serializable transport job data.
 *
 * Replaces the TransportJob class. No closures, no manager references.
 * Lifecycle operations live in TransportJobService.
 */

import type { EMaterialType } from '../../economy/material-type';

export enum TransportPhase {
    /** Inventory reserved, carrier en route to pickup */
    Reserved = 'reserved',
    /** Carrier picked up material, en route to delivery */
    PickedUp = 'picked-up',
    /** Cancelled — reservation released, request reset */
    Cancelled = 'cancelled',
    /** Delivered — request fulfilled */
    Delivered = 'delivered',
}

/** Flat, serializable transport job record. No closures, no manager refs. */
export interface TransportJobRecord {
    readonly id: number;
    readonly demandId: number;
    sourceBuilding: number; // mutable: can be redirected
    readonly destBuilding: number;
    readonly material: EMaterialType;
    readonly amount: number;
    readonly carrierId: number;
    /** Target PileSlot ID at the destination (stable across inventory lifecycle). */
    readonly slotId: number;
    phase: TransportPhase;
    /** Game time when job was created (seconds, for stall detection). */
    readonly createdAt: number;
}

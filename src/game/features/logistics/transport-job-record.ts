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
    readonly requestId: number;
    sourceBuilding: number; // mutable: can be redirected
    readonly destBuilding: number;
    readonly material: EMaterialType;
    readonly amount: number;
    readonly carrierId: number;
    phase: TransportPhase;
}

/**
 * TransportJobRecord — flat, serializable transport job data.
 *
 * The job record is the ONLY stateful representation of material in motion:
 * source-side stock reservations, destination-side incoming amounts, and
 * queued follow-up work are all derived from records and their phase.
 * Lifecycle operations live in TransportJobService.
 */

import type { EMaterialType } from '../../economy/material-type';

export enum TransportPhase {
    /** Pre-assigned to a busy carrier — activates when its current delivery finishes. */
    Queued = 'queued',
    /** Job active, carrier en route to pickup. Source stock is spoken for. */
    Reserved = 'reserved',
    /** Carrier picked up material, en route to delivery. */
    PickedUp = 'picked-up',
    /** Cancelled — record removed from the store. */
    Cancelled = 'cancelled',
    /** Delivered — record removed from the store. */
    Delivered = 'delivered',
}

/** Phases in which a job claims source stock (not yet withdrawn). */
export function claimsSourceStock(phase: TransportPhase): boolean {
    return phase === TransportPhase.Queued || phase === TransportPhase.Reserved;
}

/** Phases in which a job counts as incoming material at its destination. */
export function isIncoming(phase: TransportPhase): boolean {
    return claimsSourceStock(phase) || phase === TransportPhase.PickedUp;
}

/** Flat, serializable transport job record. No closures, no manager refs. */
export interface TransportJobRecord {
    readonly id: number;
    sourceBuilding: number; // mutable: can be redirected
    readonly destBuilding: number;
    readonly material: EMaterialType;
    readonly amount: number;
    readonly carrierId: number;
    phase: TransportPhase;
    /** Game time when job was created (seconds, for stall detection). */
    readonly createdAt: number;
}

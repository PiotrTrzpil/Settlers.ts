/**
 * Carrier state types for the logistics system.
 * Defines all types for tracking carrier state and jobs.
 */

import { EMaterialType } from '../../economy';

/**
 * Status of a carrier unit.
 */
export enum CarrierStatus {
    /** Carrier is idle at their home tavern, available for jobs */
    Idle = 0,
    /** Carrier is walking to a destination */
    Walking = 1,
    /** Carrier is picking up materials from a building */
    PickingUp = 2,
    /** Carrier is delivering materials to a building */
    Delivering = 3,
    /** Carrier is resting at their home tavern to recover fatigue */
    Resting = 4,
}

/**
 * Job types that a carrier can be assigned.
 */
export type CarrierJob =
    | { type: 'pickup'; fromBuilding: number; material: EMaterialType; amount: number }
    | { type: 'deliver'; toBuilding: number; material: EMaterialType; amount: number }
    | { type: 'return_home' };

/**
 * State tracking for a carrier unit.
 */
export interface CarrierState {
    /** Entity ID of this carrier */
    entityId: number;
    /** Entity ID of the tavern this carrier is assigned to */
    homeBuilding: number;
    /** Current job being executed (null if idle) */
    currentJob: CarrierJob | null;
    /** Fatigue level (0 = fresh, 100 = exhausted) */
    fatigue: number;
    /** Material type currently being carried (null if not carrying anything) */
    carryingMaterial: EMaterialType | null;
    /** Amount of material currently being carried */
    carryingAmount: number;
    /** Current status of the carrier */
    status: CarrierStatus;
}

/**
 * Create a new carrier state with default values.
 */
export function createCarrierState(entityId: number, homeBuilding: number): CarrierState {
    return {
        entityId,
        homeBuilding,
        currentJob: null,
        fatigue: 0,
        carryingMaterial: null,
        carryingAmount: 0,
        status: CarrierStatus.Idle,
    };
}

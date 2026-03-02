/**
 * Carrier state types for the logistics system.
 * Defines all types for tracking carrier state and status.
 */

/**
 * Status of a carrier unit.
 */
export enum CarrierStatus {
    /** Carrier is idle, available for jobs */
    Idle = 0,
    /** Carrier is walking to a destination */
    Walking = 1,
    /** Carrier is picking up materials from a building */
    PickingUp = 2,
    /** Carrier is delivering materials to a building */
    Delivering = 3,
}

/**
 * State tracking for a carrier unit.
 *
 * Job execution state lives in SettlerTaskSystem (UnitRuntime.job).
 * This type only tracks identity and status.
 *
 * Note: Material being carried is stored on entity.carrying (shared with all units).
 * Use entity.carrying.material and entity.carrying.amount to access carried material.
 */
export interface CarrierState {
    /** Entity ID of this carrier */
    entityId: number;
    /** Current status of the carrier */
    status: CarrierStatus;
}

/**
 * Create a new carrier state with default values.
 */
export function createCarrierState(entityId: number): CarrierState {
    return {
        entityId,
        status: CarrierStatus.Idle,
    };
}

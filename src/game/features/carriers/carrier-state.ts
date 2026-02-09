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
 * Fatigue level categories based on fatigue value.
 * Higher fatigue = worse condition.
 */
export enum FatigueLevel {
    /** 0-25: Full speed, can take any job */
    Fresh = 0,
    /** 26-50: Slightly slower, can still work */
    Tired = 1,
    /** 51-75: Very slow, will finish current job then rest */
    Exhausted = 2,
    /** 76-100: Cannot work, must rest */
    Collapsed = 3,
}

/** Fatigue thresholds for each level */
export const FATIGUE_THRESHOLDS = {
    [FatigueLevel.Fresh]: 0,
    [FatigueLevel.Tired]: 26,
    [FatigueLevel.Exhausted]: 51,
    [FatigueLevel.Collapsed]: 76,
} as const;

/**
 * Get the fatigue level category from a numeric fatigue value.
 */
export function getFatigueLevel(fatigue: number): FatigueLevel {
    if (fatigue >= FATIGUE_THRESHOLDS[FatigueLevel.Collapsed]) return FatigueLevel.Collapsed;
    if (fatigue >= FATIGUE_THRESHOLDS[FatigueLevel.Exhausted]) return FatigueLevel.Exhausted;
    if (fatigue >= FATIGUE_THRESHOLDS[FatigueLevel.Tired]) return FatigueLevel.Tired;
    return FatigueLevel.Fresh;
}

/**
 * Check if a carrier can accept new jobs based on fatigue level.
 * Collapsed carriers cannot work. Exhausted carriers will finish current job but won't take new ones.
 */
export function canAcceptNewJob(fatigue: number): boolean {
    const level = getFatigueLevel(fatigue);
    return level === FatigueLevel.Fresh || level === FatigueLevel.Tired;
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

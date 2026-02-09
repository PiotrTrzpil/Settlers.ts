/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierJob, CarrierStatus, FatigueLevel
 * - Manager: CarrierManager (tracks all carrier states)
 * - Helpers: createCarrierState, getFatigueLevel, canAcceptNewJob
 * - Constants: FATIGUE_THRESHOLDS
 */

// Types and helpers
export type { CarrierState, CarrierJob } from './carrier-state';
export {
    CarrierStatus,
    FatigueLevel,
    FATIGUE_THRESHOLDS,
    createCarrierState,
    getFatigueLevel,
    canAcceptNewJob,
} from './carrier-state';

// Manager
export { CarrierManager } from './carrier-manager';

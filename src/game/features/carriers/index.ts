/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management and registration.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierStatus, FatigueLevel
 * - Manager: CarrierManager (tracks all carrier states, fatigue, auto-registration)
 * - Helpers: createCarrierState, getFatigueLevel, canAcceptNewJob
 * - Constants: FATIGUE_THRESHOLDS
 *
 * Note: Task execution (movement, animation, pickup, dropoff) is handled by
 * WorkerTaskExecutor via inline transport choreography.
 */

// Types and helpers from carrier-state
export type { CarrierState } from './carrier-state';
export {
    CarrierStatus,
    FatigueLevel,
    FATIGUE_THRESHOLDS,
    createCarrierState,
    getFatigueLevel,
    canAcceptNewJob,
} from './carrier-state';

// Manager
export { CarrierManager, type CarrierManagerConfig } from './carrier-manager';

// Re-export EntityProvider from entity for convenience
export type { EntityProvider } from '../../entity';

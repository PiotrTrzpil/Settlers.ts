/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management and registration.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierJob, CarrierStatus, FatigueLevel
 * - Manager: CarrierManager (tracks all carrier states)
 * - System: CarrierSystem (tick system for fatigue and registration)
 * - Helpers: createCarrierState, getFatigueLevel, canAcceptNewJob
 * - Constants: FATIGUE_THRESHOLDS
 *
 * Note: Task execution (movement, animation, pickup, dropoff) is handled by
 * SettlerTaskSystem using the YAML-defined carrier.transport job sequence.
 */

// Types and helpers from carrier-state
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

// Re-export EntityProvider from entity for convenience
export type { EntityProvider } from '../../entity';

// System (TickSystem)
export { CarrierSystem, type CarrierSystemConfig } from './carrier-system';

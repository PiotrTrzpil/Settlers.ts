/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management and registration.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierStatus
 * - Manager: CarrierManager (tracks all carrier states, auto-registration)
 * - Helpers: createCarrierState
 *
 * Note: Task execution (movement, animation, pickup, dropoff) is handled by
 * WorkerTaskExecutor via inline transport choreography.
 */

// Types and helpers from carrier-state
export type { CarrierState } from './carrier-state';
export { CarrierStatus, createCarrierState } from './carrier-state';

// Manager
export { CarrierManager, type CarrierManagerConfig } from './carrier-manager';

// Feature definition
export { CarrierFeature, type CarrierFeatureExports } from './carrier-feature';

// Re-export EntityProvider from entity for convenience
export type { EntityProvider } from '../../entity';

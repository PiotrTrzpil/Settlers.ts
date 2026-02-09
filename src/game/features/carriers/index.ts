/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierJob, CarrierStatus
 * - Manager: CarrierManager (tracks all carrier states)
 * - Helpers: createCarrierState
 */

// Types
export type { CarrierState, CarrierJob } from './carrier-state';
export { CarrierStatus, createCarrierState } from './carrier-state';

// Manager
export { CarrierManager } from './carrier-manager';

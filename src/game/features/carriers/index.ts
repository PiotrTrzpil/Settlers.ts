/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management and job execution.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierJob, CarrierStatus, FatigueLevel
 * - Manager: CarrierManager (tracks all carrier states)
 * - System: CarrierSystem (tick system for carrier behavior)
 * - Job Completion: handleJobCompletion, JobCompletionResult
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

// System (TickSystem)
export { CarrierSystem, type PendingDelivery } from './carrier-system';

// Job completion handlers
export {
    handleJobCompletion,
    handlePickupCompletion,
    handleDeliveryCompletion,
    handleReturnHomeCompletion,
    type JobCompletionResult,
} from './job-completion';

/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management and behavior.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: CarrierState, CarrierJob, CarrierStatus, FatigueLevel
 * - Manager: CarrierManager (tracks all carrier states)
 * - System: CarrierSystem (tick system for carrier behavior)
 * - Movement: CarrierMovementController (issues movement commands)
 * - Animation: CarrierAnimationController (manages animation states)
 * - Helpers: createCarrierState, getFatigueLevel, canAcceptNewJob
 * - Constants: FATIGUE_THRESHOLDS, PICKUP_ANIMATION_DURATION_MS, DROP_ANIMATION_DURATION_MS
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

// System (TickSystem)
export { CarrierSystem } from './carrier-system';

// Movement controller
export type { PendingMovement } from './carrier-movement';
export { CarrierMovementController } from './carrier-movement';

// Animation controller
export type { AnimationTimer } from './carrier-animation';
export {
    CarrierAnimationController,
    PICKUP_ANIMATION_DURATION_MS,
    DROP_ANIMATION_DURATION_MS,
} from './carrier-animation';

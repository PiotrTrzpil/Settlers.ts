/**
 * Game Features Barrel Export
 *
 * This file re-exports all feature modules for convenient imports.
 * Features are self-contained modules that implement game functionality.
 *
 * Available features:
 * - carriers: Carrier entity state management and logistics behavior
 * - inventory: Building input/output material slots
 * - service-areas: Tavern service area management
 * - logistics: Resource request and fulfillment matching
 * - building-construction: Building construction phases
 * - placement: Building placement validation
 */

// Carrier system
export * from './carriers';

// Building inventory
export * from './inventory';

// Service areas for logistics hubs
export * from './service-areas';

// Logistics: resource requests and fulfillment
export * from './logistics';

// Building construction
export * from './building-construction';

// Building placement
export * from './placement';

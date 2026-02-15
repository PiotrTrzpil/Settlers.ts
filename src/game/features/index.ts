/**
 * Game Features Barrel Export
 *
 * This file re-exports all feature modules for convenient imports.
 * Features are self-contained modules that implement game functionality.
 *
 * Feature System:
 * - feature.ts: Feature interface and types
 * - feature-registry.ts: FeatureRegistry for loading features
 *
 * Available features:
 * - carriers: Carrier entity state management and logistics behavior
 * - inventory: Building input/output material slots
 * - service-areas: Tavern service area management
 * - logistics: Resource request and fulfillment matching
 * - building-construction: Building construction phases
 * - placement: Building placement validation
 * - trees: Tree lifecycle (growth, cutting, decay)
 */

// Feature system infrastructure
export * from './feature';
export * from './feature-registry';

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

// Trees (first feature using self-registration)
export * from './trees';

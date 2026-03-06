/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier membership tracking.
 * External code should only import from this file.
 *
 * Public API:
 * - CarrierRegistry (set-based carrier membership + ComponentStore)
 * - CarrierFeature, CarrierFeatureExports
 */

export { CarrierRegistry, type CarrierRegistryConfig } from './carrier-manager';
export { CarrierFeature, type CarrierFeatureExports } from './carrier-feature';
export type { EntityProvider } from '../../entity';

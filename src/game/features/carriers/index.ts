/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier membership tracking.
 * External code should only import from this file.
 *
 * Public API:
 * - CarrierRegistry (set-based carrier membership + ComponentStore)
 * - IdleCarrierPool (spatial lookup of idle, unreserved carriers)
 * - CarrierFeature, CarrierFeatureExports
 */

export { CarrierRegistry, type CarrierRegistryConfig } from './carrier-registry';
export { CarrierFeature, type CarrierFeatureExports } from './carrier-feature';
export { IdleCarrierPool, type CarrierEligibilityFilter } from './idle-carrier-pool';
export type { EntityProvider } from '../../entity';

/**
 * Territory Feature Module
 *
 * Self-contained module for territory zone management.
 * Towers and castles create territory zones; boundary dots visualize edges.
 *
 * Public API:
 * - Feature: TerritoryFeature (FeatureDefinition with onTerrainReady)
 * - Manager: TerritoryManager (territory ownership queries, boundary dots)
 * - Types: TerritoryDot, TerritoryExports
 * - Constants: TERRITORY_BUILDINGS, TERRITORY_RADIUS
 */

export { TerritoryFeature, type TerritoryExports } from './territory-feature';
export { TerritoryManager } from './territory-manager';
export type { TerritoryDot } from './territory-types';
export { TERRITORY_BUILDINGS, TERRITORY_RADIUS } from './territory-types';
export {
    createTerritoryPlacementFilter,
    createTerritoryMatchFilter,
    createTerritoryCarrierFilter,
} from './territory-filters';

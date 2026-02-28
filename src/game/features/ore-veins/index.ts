/**
 * Ore Veins Feature Module
 *
 * Per-tile ore data on mountain terrain, consumed by mine buildings.
 * Includes ore sign system for geologist prospecting visualization.
 *
 * Public API:
 * - Types: OreType, OreSignExports
 * - Data: OreVeinData (per-tile ore type, level, prospected state)
 * - System: ResourceSignSystem (sign entity lifecycle)
 * - Feature: OreSignFeature (feature registration)
 */

export { OreType, MAX_ORE_LEVEL, MINE_SEARCH_RADIUS, MINE_ORE_TYPE } from './ore-type';
export { OreVeinData } from './ore-vein-data';
export { populateOreVeins, loadOreVeinsFromResourceData } from './populate-ore-veins';
export { ResourceSignSystem } from './resource-sign-system';
export { OreSignFeature, type OreSignExports } from './ore-sign-feature';

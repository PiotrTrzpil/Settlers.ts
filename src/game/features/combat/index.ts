/**
 * Combat Feature Module
 *
 * Manages military unit combat: enemy detection, pursuit, and melee damage.
 * Military units automatically detect nearby enemies, move toward them,
 * and deal periodic damage when adjacent.
 *
 * Public API:
 * - Types: CombatState, CombatStatus, CombatStats
 * - System: CombatSystem (TickSystem — enemy scan, pursuit, damage)
 * - Feature: CombatFeature (FeatureDefinition — self-registering)
 * - Helpers: getCombatStats, createCombatState
 */

export type { CombatState, CombatStats } from './combat-state';
export { CombatStatus, getCombatStats, createCombatState } from './combat-state';
export { CombatSystem } from './combat-system';
export { CombatFeature, type CombatExports } from './combat-feature';

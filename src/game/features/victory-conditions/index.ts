/**
 * Victory Conditions Feature Module
 *
 * Checks win/loss conditions: castle-based elimination (Settlers 4 default).
 *
 * Public API:
 * - Feature: VictoryConditionsFeature (FeatureDefinition)
 * - System: VictoryConditionsSystem (per-tick checks, query API)
 * - Types: GameResult, GameEndReason, PlayerStatus
 */

export { VictoryConditionsFeature, type VictoryConditionsExports } from './victory-conditions-feature';
export { VictoryConditionsSystem, PlayerStatus, GameEndReason } from './victory-conditions-system';
export type { GameResult, VictoryConditionsConfig } from './victory-conditions-system';

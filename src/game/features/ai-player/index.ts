/**
 * AI Player Feature Module
 *
 * Computer-controlled player using a behavior-tree-based decision engine.
 * Builds economy via race-specific build orders, trains soldiers, and
 * attacks enemies — all through the standard command system.
 *
 * Public API:
 * - Feature: AiPlayerFeature (FeatureDefinition)
 * - System: AiPlayerSystem (per-tick AI evaluation, player management)
 * - Types: AiPlayerConfig, AiPlayerState, AiPlayerExports, BuildStep
 */

export { AiPlayerFeature } from './ai-player-feature';
export type {
    AiPlayerConfig,
    AiPlayerState,
    AiPlayerExports,
    AiPlayerSystem,
    BuildStep,
    BuildOrderFactory,
} from './types';

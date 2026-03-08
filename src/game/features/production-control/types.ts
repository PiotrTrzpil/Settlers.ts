/**
 * Production Control — shared types for per-building production mode and recipe selection.
 *
 * A building with multiple recipes (e.g., ToolSmith, WeaponSmith) has an associated
 * ProductionState that controls which recipe to produce next and in what proportion.
 *
 * Modes:
 * - 'even'         — strict round-robin through all recipes (ignores proportions)
 * - 'proportional' — weighted production converging to target proportions
 * - 'manual'       — ordered queue driven by explicit player-enqueued recipe indices
 */

// ============================================================================
// Production Mode — defined in event-bus (no feature deps), re-exported here.
// ============================================================================

import { ProductionMode } from '@/game/event-bus';
export { ProductionMode };

// ============================================================================
// Production State
// ============================================================================

/**
 * Runtime production state for a single multi-recipe building.
 *
 * Keyed by building entity ID inside ProductionControlManager.
 * Only buildings with multiple recipes have an associated ProductionState.
 */
export interface ProductionState {
    /** How the next recipe is selected. */
    mode: ProductionMode;

    /**
     * Per-recipe target weights for 'even' and 'proportional' modes.
     * Maps recipe index → weight (clamped 0–10).
     * Initialised to 1 for every recipe when the building is registered.
     */
    proportions: Map<number, number>;

    /**
     * Ordered recipe-index queue for 'manual' mode.
     * Items are popped from the front on each production cycle.
     * Building idles (returns null) when the queue is empty.
     */
    queue: number[];

    /**
     * Round-robin cursor for 'even' mode.
     * Points to the index of the next recipe to produce.
     * Reset to 0 when switching back to 'even' mode.
     */
    roundRobinIndex: number;

    /**
     * Running tally of how many times each recipe has been produced this session.
     * Maps recipe index → count.
     * Used by 'proportional' mode to calculate actual vs target ratios.
     */
    productionCounts: Map<number, number>;

    /**
     * Total number of recipes available for this building.
     * Stored at init time so selection strategies can iterate indices without
     * needing an external RecipeSet reference.
     */
    recipeCount: number;
}

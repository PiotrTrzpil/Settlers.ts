/**
 * Production Control — shared types for per-building production mode and recipe selection.
 *
 * A building with multiple recipes (e.g., ToolSmith, WeaponSmith) has an associated
 * ProductionState that controls which recipe to produce next and in what proportion.
 *
 * Modes:
 * - 'even'         — strict round-robin through all recipes (ignores proportions)
 * - 'proportional' — weighted production converging to target proportions
 * - 'manual'       — ordered queue driven by explicit player-enqueued outputs
 */

import type { EMaterialType } from '@/game/economy/material-type';

// ============================================================================
// Production Mode
// ============================================================================

/** Controls how the next recipe is selected for a multi-recipe building. */
export type ProductionMode = 'even' | 'proportional' | 'manual';

// ============================================================================
// Production State
// ============================================================================

/**
 * Runtime production state for a single multi-recipe building.
 *
 * Keyed by building entity ID inside ProductionControlManager.
 * Only buildings with a RecipeSet have an associated ProductionState.
 */
export interface ProductionState {
    /** How the next recipe is selected. */
    mode: ProductionMode;

    /**
     * Per-recipe target weights for 'even' and 'proportional' modes.
     * Maps output material → weight (clamped 0–10).
     * Initialised to 1 for every recipe when the building is registered.
     */
    proportions: Map<EMaterialType, number>;

    /**
     * Ordered output queue for 'manual' mode.
     * Items are popped from the front on each production cycle.
     * Building idles (returns null) when the queue is empty.
     */
    queue: EMaterialType[];

    /**
     * Round-robin cursor for 'even' mode.
     * Points to the index in RecipeSet.recipes of the next recipe to produce.
     * Reset to 0 when switching back to 'even' mode.
     */
    roundRobinIndex: number;

    /**
     * Running tally of how many times each recipe has been produced this session.
     * Maps output material → count.
     * Used by 'proportional' mode to calculate actual vs target ratios.
     */
    productionCounts: Map<EMaterialType, number>;
}

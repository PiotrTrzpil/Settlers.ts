/**
 * Production Control Manager
 *
 * Tracks per-building production mode and recipe selection for multi-recipe buildings.
 * Single-recipe buildings are not tracked — callers fall back to their ProductionChain.
 *
 * Responsibilities:
 * - Maintain ProductionState keyed by building entity ID
 * - Implement even, proportional, and manual recipe selection strategies
 * - Expose player-facing controls: setMode, setProportion, addToQueue, removeFromQueue
 */

import type { BuildingType } from '@/game/entity';
import type { EMaterialType } from '@/game/economy/material-type';
import { getRecipeSet } from '@/game/economy/building-production';
import type { Recipe } from '@/game/economy/building-production';
import type { ProductionMode, ProductionState } from './types';

/**
 * Manages runtime production state for all multi-recipe buildings.
 *
 * Usage:
 * ```typescript
 * const manager = new ProductionControlManager();
 * manager.initBuilding(buildingId, BuildingType.ToolSmith);
 * const recipe = manager.getNextRecipe(buildingId, BuildingType.ToolSmith);
 * ```
 */
export class ProductionControlManager {
    private readonly states: Map<number, ProductionState> = new Map();

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Register a building with the manager.
     *
     * If the building type has a RecipeSet, a fresh ProductionState is created with:
     * - mode = 'even'
     * - equal proportions (weight=1) for every recipe
     * - empty queue, zero counts, roundRobinIndex=0
     *
     * Single-recipe buildings are silently ignored — they need no state.
     *
     * @param buildingId  Entity ID of the building.
     * @param buildingType  BuildingType enum value.
     */
    initBuilding(buildingId: number, buildingType: BuildingType): void {
        const recipeSet = getRecipeSet(buildingType);
        if (!recipeSet) return; // Single-recipe — no state needed.

        const proportions = new Map<EMaterialType, number>();
        const productionCounts = new Map<EMaterialType, number>();

        for (const recipe of recipeSet.recipes) {
            proportions.set(recipe.output, 1);
            productionCounts.set(recipe.output, 0);
        }

        const state: ProductionState = {
            mode: 'even',
            proportions,
            queue: [],
            roundRobinIndex: 0,
            productionCounts,
        };

        this.states.set(buildingId, state);
    }

    /**
     * Unregister a building, freeing its state.
     *
     * @param buildingId  Entity ID of the building.
     */
    removeBuilding(buildingId: number): void {
        this.states.delete(buildingId);
    }

    // =========================================================================
    // Core recipe selection
    // =========================================================================

    /**
     * Select and return the next Recipe for a production cycle.
     *
     * Returns null in two cases:
     * 1. The building is a single-recipe building (no state) — caller uses ProductionChain.
     * 2. The building is in 'manual' mode with an empty queue — building idles.
     *
     * Always increments productionCounts for the chosen recipe.
     *
     * @param buildingId   Entity ID of the building.
     * @param buildingType BuildingType enum value (needed to resolve RecipeSet).
     */
    getNextRecipe(buildingId: number, buildingType: BuildingType): Recipe | null {
        const state = this.states.get(buildingId);
        if (!state) return null; // Single-recipe building — caller falls back.

        const recipeSet = getRecipeSet(buildingType);
        if (!recipeSet) {
            throw new Error(
                `ProductionControlManager: state exists for building ${buildingId} ` +
                    `(${buildingType}) but no RecipeSet found — state is corrupted.`
            );
        }

        const { recipes } = recipeSet;

        let recipe: Recipe;

        switch (state.mode) {
        case 'even':
            recipe = this.selectEven(state, recipes);
            break;
        case 'proportional':
            recipe = this.selectProportional(state, recipes);
            break;
        case 'manual':
            return this.selectManual(state, recipes);
        default: {
            const exhaustive: never = state.mode;
            throw new Error(`ProductionControlManager: unknown mode '${exhaustive}' for building ${buildingId}.`);
        }
        }

        state.productionCounts.set(recipe.output, (state.productionCounts.get(recipe.output) ?? 0) + 1);
        return recipe;
    }

    // =========================================================================
    // Selection strategies (private)
    // =========================================================================

    /**
     * Round-robin selection: advance the cursor and return the recipe at that position.
     */
    private selectEven(state: ProductionState, recipes: readonly Recipe[]): Recipe {
        const recipe = recipes[state.roundRobinIndex % recipes.length]!;
        state.roundRobinIndex = (state.roundRobinIndex + 1) % recipes.length;
        return recipe;
    }

    /**
     * Weighted deficit selection: pick the recipe furthest behind its target proportion.
     *
     * Algorithm:
     * 1. Compute totalProduced and totalWeight across all recipes.
     * 2. For each recipe, compute its actual share (produced / totalProduced)
     *    and its target share (weight / totalWeight).
     * 3. Select the recipe with the largest deficit (target − actual).
     * 4. Ties are broken by recipe order (first in RecipeSet wins).
     *
     * When totalProduced is zero (first cycle), fall back to even selection.
     */
    private selectProportional(state: ProductionState, recipes: readonly Recipe[]): Recipe {
        const totalProduced = [...state.productionCounts.values()].reduce((sum, c) => sum + c, 0);

        if (totalProduced === 0) {
            // No history yet — fall back to even for the first cycle.
            return this.selectEven(state, recipes);
        }

        let totalWeight = 0;
        for (const recipe of recipes) {
            totalWeight += state.proportions.get(recipe.output) ?? 1;
        }

        if (totalWeight === 0) {
            // All weights are zero — treat as even.
            return this.selectEven(state, recipes);
        }

        let bestRecipe = recipes[0]!;
        let bestDeficit = -Infinity;

        for (const recipe of recipes) {
            const weight = state.proportions.get(recipe.output) ?? 1;
            const targetShare = weight / totalWeight;
            const produced = state.productionCounts.get(recipe.output) ?? 0;
            const actualShare = produced / totalProduced;
            const deficit = targetShare - actualShare;

            if (deficit > bestDeficit) {
                bestDeficit = deficit;
                bestRecipe = recipe;
            }
        }

        return bestRecipe;
    }

    /**
     * Manual queue selection: pop the first output material from the queue,
     * find the matching recipe, and return it. Returns null (idle) if queue is empty.
     *
     * Throws if the queued output does not match any recipe — that indicates a bug
     * in how queue items were added.
     */
    private selectManual(state: ProductionState, recipes: readonly Recipe[]): Recipe | null {
        if (state.queue.length === 0) return null; // Building idles.

        const output = state.queue.shift()!;
        const recipe = recipes.find(r => r.output === output);

        if (!recipe) {
            throw new Error(
                `ProductionControlManager: queued output ${output} does not match any recipe ` +
                    `in the RecipeSet. Queue may be stale — clear and re-add entries.`
            );
        }

        state.productionCounts.set(recipe.output, (state.productionCounts.get(recipe.output) ?? 0) + 1);
        return recipe;
    }

    // =========================================================================
    // Player-facing controls
    // =========================================================================

    /**
     * Change the production mode for a building.
     *
     * Switching to 'even' resets the round-robin cursor to 0 so production
     * starts fresh from the first recipe rather than resuming mid-cycle.
     *
     * @param buildingId Entity ID of the building.
     * @param mode       New production mode.
     */
    setMode(buildingId: number, mode: ProductionMode): void {
        const state = this.requireState(buildingId);
        state.mode = mode;
        if (mode === 'even') {
            state.roundRobinIndex = 0;
        }
    }

    /**
     * Update the target weight for a recipe identified by its output material.
     *
     * Weight is clamped to [0, 10]. A weight of 0 effectively disables the recipe
     * in proportional mode (it will never be selected unless all weights are 0).
     *
     * @param buildingId Entity ID of the building.
     * @param output     Output material that identifies the recipe.
     * @param weight     Target weight in the range [0, 10].
     */
    setProportion(buildingId: number, output: EMaterialType, weight: number): void {
        const state = this.requireState(buildingId);
        const clamped = Math.max(0, Math.min(10, weight));
        state.proportions.set(output, clamped);
    }

    /**
     * Append an output material to the end of the manual production queue.
     *
     * @param buildingId Entity ID of the building.
     * @param output     Output material to enqueue.
     */
    addToQueue(buildingId: number, output: EMaterialType): void {
        const state = this.requireState(buildingId);
        state.queue.push(output);
    }

    /**
     * Remove the last occurrence of an output material from the manual queue.
     *
     * This mirrors a "decrement" UI action — if the player added the same recipe
     * multiple times, each call removes one instance from the back.
     * Does nothing if the output is not in the queue.
     *
     * @param buildingId Entity ID of the building.
     * @param output     Output material whose last queue entry should be removed.
     */
    removeFromQueue(buildingId: number, output: EMaterialType): void {
        const state = this.requireState(buildingId);
        for (let i = state.queue.length - 1; i >= 0; i--) {
            if (state.queue[i] === output) {
                state.queue.splice(i, 1);
                return;
            }
        }
        // Output not in queue — nothing to do.
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /**
     * Return a readonly view of the current ProductionState for a building.
     * Returns undefined for single-recipe buildings (no state tracked).
     *
     * @param buildingId Entity ID of the building.
     */
    getProductionState(buildingId: number): Readonly<ProductionState> | undefined {
        return this.states.get(buildingId);
    }

    /**
     * Return all recipes available for a building.
     * Returns an empty array for single-recipe buildings (use ProductionChain instead).
     *
     * @param buildingId   Entity ID of the building (unused, for API symmetry).
     * @param buildingType BuildingType enum value to resolve the RecipeSet.
     */
    getRecipes(_buildingId: number, buildingType: BuildingType): readonly Recipe[] {
        return getRecipeSet(buildingType)?.recipes ?? [];
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Retrieve state or throw with context if missing.
     * Use for operations that require an existing state (setMode, setProportion, etc.).
     */
    private requireState(buildingId: number): ProductionState {
        const state = this.states.get(buildingId);
        if (!state) {
            throw new Error(
                `ProductionControlManager: no state for building ${buildingId}. ` +
                    `Ensure initBuilding() was called for a multi-recipe building.`
            );
        }
        return state;
    }
}

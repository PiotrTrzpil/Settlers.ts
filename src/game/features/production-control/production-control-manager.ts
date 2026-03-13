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

import { ProductionMode, type ProductionState } from './types';
import { type ComponentStore, mapStore } from '../../ecs';
import { PersistentMap } from '@/game/persistence/persistent-store';

/**
 * Manages runtime production state for all multi-recipe buildings.
 *
 * Usage:
 * ```typescript
 * const manager = new ProductionControlManager();
 * manager.initBuilding(buildingId, recipeCount);
 * const recipeIndex = manager.getNextRecipeIndex(buildingId);
 * ```
 */
export class ProductionControlManager {
    readonly persistentStore = new PersistentMap<ProductionState>('productionControl');

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<ProductionState> = mapStore(this.persistentStore.raw);

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Register a building with the manager.
     *
     * Creates a fresh ProductionState with:
     * - mode = ProductionMode.Even
     * - equal proportions (weight=1) for every recipe index 0..recipeCount-1
     * - empty queue, zero counts, roundRobinIndex=0
     *
     * @param buildingId  Entity ID of the building.
     * @param recipeCount Number of recipes available for this building.
     */
    initBuilding(buildingId: number, recipeCount: number): void {
        const proportions = new Map<number, number>();
        const productionCounts = new Map<number, number>();

        for (let i = 0; i < recipeCount; i++) {
            proportions.set(i, 1);
            productionCounts.set(i, 0);
        }

        const state: ProductionState = {
            mode: ProductionMode.Even,
            proportions,
            queue: [],
            roundRobinIndex: 0,
            productionCounts,
            recipeCount,
        };

        this.persistentStore.set(buildingId, state);
    }

    /**
     * Unregister a building, freeing its state.
     *
     * @param buildingId  Entity ID of the building.
     */
    removeBuilding(buildingId: number): void {
        this.persistentStore.delete(buildingId);
    }

    // =========================================================================
    // Core recipe selection
    // =========================================================================

    /**
     * Peek at the next recipe index that would be selected, without consuming it.
     *
     * Use this to check prerequisites (inputs, carrier availability) before
     * committing to the recipe via getNextRecipeIndex().
     *
     * Returns null when the building has no state or manual mode queue is empty.
     */
    peekNextRecipeIndex(buildingId: number): number | null {
        const state = this.persistentStore.get(buildingId);
        if (!state) {
            return null;
        }

        switch (state.mode) {
            case ProductionMode.Even:
                return state.roundRobinIndex % state.recipeCount;
            case ProductionMode.Proportional:
                return this.peekProportional(state);
            case ProductionMode.Manual:
                return state.queue.length > 0 ? state.queue[0]! : null;
            default: {
                const exhaustive: never = state.mode;
                throw new Error(
                    `ProductionControlManager: unknown mode '${String(exhaustive)}' for building ${buildingId}.`
                );
            }
        }
    }

    /**
     * Select and return the next recipe index for a production cycle.
     *
     * Returns null in two cases:
     * 1. The building has no tracked state (not registered) — caller uses ProductionChain.
     * 2. The building is in ProductionMode.Manual mode with an empty queue — building idles.
     *
     * Always increments productionCounts for the chosen index (except manual which
     * handles it internally via selectManual).
     *
     * @param buildingId  Entity ID of the building.
     */
    getNextRecipeIndex(buildingId: number): number | null {
        const state = this.persistentStore.get(buildingId);
        if (!state) {
            return null;
        } // No state — caller falls back to single-recipe path.

        let index: number;

        switch (state.mode) {
            case ProductionMode.Even:
                index = this.selectEven(state);
                break;
            case ProductionMode.Proportional:
                index = this.selectProportional(state);
                break;
            case ProductionMode.Manual:
                return this.selectManual(state);
            default: {
                const exhaustive: never = state.mode;
                throw new Error(
                    `ProductionControlManager: unknown mode '${String(exhaustive)}' for building ${buildingId}.`
                );
            }
        }

        state.productionCounts.set(index, (state.productionCounts.get(index) ?? 0) + 1);
        return index;
    }

    // =========================================================================
    // Selection strategies (private)
    // =========================================================================

    /**
     * Round-robin selection: advance the cursor and return the recipe index at that position.
     */
    private selectEven(state: ProductionState): number {
        const index = state.roundRobinIndex % state.recipeCount;
        state.roundRobinIndex = (state.roundRobinIndex + 1) % state.recipeCount;
        return index;
    }

    /**
     * Peek at proportional selection without mutating state.
     */
    private peekProportional(state: ProductionState): number {
        const totalProduced = [...state.productionCounts.values()].reduce((sum, c) => sum + c, 0);
        if (totalProduced === 0) {
            return state.roundRobinIndex % state.recipeCount;
        }

        let totalWeight = 0;
        for (let i = 0; i < state.recipeCount; i++) {
            totalWeight += state.proportions.get(i) ?? 1;
        }
        if (totalWeight === 0) {
            return state.roundRobinIndex % state.recipeCount;
        }

        let bestIndex = 0;
        let bestDeficit = -Infinity;
        for (let i = 0; i < state.recipeCount; i++) {
            const weight = state.proportions.get(i) ?? 1;
            const targetShare = weight / totalWeight;
            const produced = state.productionCounts.get(i) ?? 0;
            const actualShare = produced / totalProduced;
            const deficit = targetShare - actualShare;
            if (deficit > bestDeficit) {
                bestDeficit = deficit;
                bestIndex = i;
            }
        }
        return bestIndex;
    }

    /**
     * Weighted deficit selection: pick the recipe index furthest behind its target proportion.
     *
     * Algorithm:
     * 1. Compute totalProduced and totalWeight across all recipe indices.
     * 2. For each index, compute its actual share (produced / totalProduced)
     *    and its target share (weight / totalWeight).
     * 3. Select the index with the largest deficit (target − actual).
     * 4. Ties are broken by index order (lowest index wins).
     *
     * When totalProduced is zero (first cycle), fall back to even selection.
     */
    private selectProportional(state: ProductionState): number {
        const totalProduced = [...state.productionCounts.values()].reduce((sum, c) => sum + c, 0);

        if (totalProduced === 0) {
            // No history yet — fall back to even for the first cycle.
            return this.selectEven(state);
        }

        let totalWeight = 0;
        for (let i = 0; i < state.recipeCount; i++) {
            totalWeight += state.proportions.get(i) ?? 1;
        }

        if (totalWeight === 0) {
            // All weights are zero — treat as even.
            return this.selectEven(state);
        }

        let bestIndex = 0;
        let bestDeficit = -Infinity;

        for (let i = 0; i < state.recipeCount; i++) {
            const weight = state.proportions.get(i) ?? 1;
            const targetShare = weight / totalWeight;
            const produced = state.productionCounts.get(i) ?? 0;
            const actualShare = produced / totalProduced;
            const deficit = targetShare - actualShare;

            if (deficit > bestDeficit) {
                bestDeficit = deficit;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    /**
     * Manual queue selection: pop the first recipe index from the queue and return it.
     * Returns null (idle) if queue is empty.
     *
     * Increments productionCounts for the chosen index.
     */
    private selectManual(state: ProductionState): number | null {
        if (state.queue.length === 0) {
            return null;
        } // Building idles.

        const index = state.queue.shift()!;
        state.productionCounts.set(index, (state.productionCounts.get(index) ?? 0) + 1);
        return index;
    }

    // =========================================================================
    // Player-facing controls
    // =========================================================================

    /**
     * Change the production mode for a building.
     *
     * Switching to ProductionMode.Even resets the round-robin cursor to 0 so production
     * starts fresh from the first recipe rather than resuming mid-cycle.
     *
     * @param buildingId Entity ID of the building.
     * @param mode       New production mode.
     */
    setMode(buildingId: number, mode: ProductionMode): void {
        const state = this.requireState(buildingId);
        state.mode = mode;
        if (mode === ProductionMode.Even) {
            state.roundRobinIndex = 0;
        }
    }

    /**
     * Update the target weight for a recipe identified by its index.
     *
     * Weight is clamped to [0, 10]. A weight of 0 effectively disables the recipe
     * in proportional mode (it will never be selected unless all weights are 0).
     *
     * @param buildingId  Entity ID of the building.
     * @param recipeIndex Recipe index (0..recipeCount-1).
     * @param weight      Target weight in the range [0, 10].
     */
    setProportion(buildingId: number, recipeIndex: number, weight: number): void {
        const state = this.requireState(buildingId);
        const clamped = Math.max(0, Math.min(10, weight));
        state.proportions.set(recipeIndex, clamped);
    }

    /**
     * Append a recipe index to the end of the manual production queue.
     *
     * @param buildingId  Entity ID of the building.
     * @param recipeIndex Recipe index to enqueue.
     */
    addToQueue(buildingId: number, recipeIndex: number): void {
        const state = this.requireState(buildingId);
        state.queue.push(recipeIndex);
    }

    /**
     * Remove the last occurrence of a recipe index from the manual queue.
     *
     * This mirrors a "decrement" UI action — if the player added the same recipe
     * multiple times, each call removes one instance from the back.
     * Does nothing if the index is not in the queue.
     *
     * @param buildingId  Entity ID of the building.
     * @param recipeIndex Recipe index whose last queue entry should be removed.
     */
    removeFromQueue(buildingId: number, recipeIndex: number): void {
        const state = this.requireState(buildingId);
        for (let i = state.queue.length - 1; i >= 0; i--) {
            if (state.queue[i] === recipeIndex) {
                state.queue.splice(i, 1);
                return;
            }
        }
        // Index not in queue — nothing to do.
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /**
     * Return a readonly view of the current ProductionState for a building.
     * Returns undefined for buildings with no tracked state.
     *
     * @param buildingId Entity ID of the building.
     */
    getProductionState(buildingId: number): Readonly<ProductionState> | undefined {
        return this.persistentStore.get(buildingId);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Retrieve state or throw with context if missing.
     * Use for operations that require an existing state (setMode, setProportion, etc.).
     */
    private requireState(buildingId: number): ProductionState {
        const state = this.persistentStore.get(buildingId);
        if (!state) {
            throw new Error(
                `ProductionControlManager: no state for building ${buildingId}. ` +
                    `Ensure initBuilding() was called before invoking player-facing controls.`
            );
        }
        return state;
    }
}

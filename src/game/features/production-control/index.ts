/**
 * Production Control Feature Module
 *
 * Runtime state manager for per-building production mode and recipe selection.
 * Buildings must be registered via initBuilding(buildingId, recipeCount).
 * The manager is recipe-index-keyed: it selects indices 0..recipeCount-1 and
 * callers resolve the concrete Recipe from their own RecipeSet.
 *
 * Public API:
 * - Types: ProductionMode, ProductionState
 * - Manager: ProductionControlManager
 *
 * Usage:
 * ```typescript
 * import { ProductionControlManager } from '@/game/features/production-control';
 *
 * const manager = new ProductionControlManager();
 *
 * // Register a building when it is constructed, passing the number of recipes
 * manager.initBuilding(buildingId, recipeSet.recipes.length);
 *
 * // Select the next recipe index during a production cycle
 * const recipeIndex = manager.getNextRecipeIndex(buildingId);
 * if (recipeIndex !== null) {
 *   const recipe = recipeSet.recipes[recipeIndex];
 *   // Produce recipe.output, consume recipe.inputs
 * }
 *
 * // Player adjusts production proportions via UI
 * manager.setMode(buildingId, 'proportional');
 * manager.setProportion(buildingId, 0, 3); // recipe index 0, weight 3
 * manager.setProportion(buildingId, 1, 1); // recipe index 1, weight 1
 *
 * // Manual queue control
 * manager.setMode(buildingId, 'manual');
 * manager.addToQueue(buildingId, 2);    // enqueue recipe index 2
 * manager.removeFromQueue(buildingId, 2); // remove one occurrence of index 2
 *
 * // Clean up on building destruction
 * manager.removeBuilding(buildingId);
 * ```
 */

// Types
export { ProductionMode } from './types';
export type { ProductionState } from './types';

// Manager
export { ProductionControlManager } from './production-control-manager';

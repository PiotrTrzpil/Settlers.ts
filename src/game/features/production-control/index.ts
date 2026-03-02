/**
 * Production Control Feature Module
 *
 * Runtime state manager for per-building production mode and recipe selection.
 * Only multi-recipe buildings (those with a RecipeSet) have tracked state.
 * Single-recipe buildings are transparent to this module.
 *
 * Public API:
 * - Types: ProductionMode, ProductionState
 * - Manager: ProductionControlManager, ProductionControlManagerConfig
 *
 * Usage:
 * ```typescript
 * import { ProductionControlManager } from '@/game/features/production-control';
 *
 * const manager = new ProductionControlManager();
 *
 * // Register a ToolSmith building when it is constructed
 * manager.initBuilding(buildingId, BuildingType.ToolSmith);
 *
 * // Select the next recipe during a production cycle
 * const recipe = manager.getNextRecipe(buildingId, BuildingType.ToolSmith);
 * if (recipe) {
 *   // Produce recipe.output, consume recipe.inputs
 * } else {
 *   // Single-recipe building — fall back to ProductionChain
 * }
 *
 * // Player adjusts production proportions via UI
 * manager.setMode(buildingId, 'proportional');
 * manager.setProportion(buildingId, EMaterialType.AXE, 3);
 * manager.setProportion(buildingId, EMaterialType.SAW, 1);
 *
 * // Manual queue control
 * manager.setMode(buildingId, 'manual');
 * manager.addToQueue(buildingId, EMaterialType.PICKAXE);
 * manager.addToQueue(buildingId, EMaterialType.AXE);
 * manager.removeFromQueue(buildingId, EMaterialType.AXE);
 *
 * // Clean up on building destruction
 * manager.removeBuilding(buildingId);
 * ```
 */

// Types
export type { ProductionMode, ProductionState } from './types';

// Manager
export { ProductionControlManager } from './production-control-manager';

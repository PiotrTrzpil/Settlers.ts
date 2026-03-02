/**
 * Building Inventory Feature Module
 *
 * Provides inventory management for buildings, tracking input and output material slots.
 *
 * Public API:
 * - Types: InventorySlot, BuildingInventory, InventoryConfig, SlotConfig, DepositResult, WithdrawResult
 * - Manager: BuildingInventoryManager (with change callbacks for UI updates)
 * - Helpers: createSlot, canAccept, canAcceptAny, canProvide, deposit, withdraw, depositWithResult, withdrawWithResult
 * - Config: getInventoryConfig, hasInventory, isProductionBuilding
 * - Constants: SLOT_CAPACITY
 */

// Slot types and helpers
export type { InventorySlot, DepositResult, WithdrawResult } from './inventory-slot';
export {
    createSlot,
    canAccept,
    canAcceptAny,
    canProvide,
    deposit,
    depositWithResult,
    withdraw,
    withdrawWithResult,
    getAvailableSpace,
    isEmpty,
    isFull,
} from './inventory-slot';

// Building inventory manager
export type { BuildingInventory, InventoryChangeCallback } from './building-inventory';
export { BuildingInventoryManager } from './building-inventory';

// Recipe type (re-exported for consumers of this feature module)
export type { Recipe } from '@/game/economy/building-production';

// Inventory configurations
export type { SlotConfig, InventoryConfig } from './inventory-configs';
export {
    SLOT_CAPACITY,
    DEFAULT_INPUT_CAPACITY,
    DEFAULT_OUTPUT_CAPACITY,
    getInventoryConfig,
    hasInventory,
    isProductionBuilding,
    consumesMaterials,
} from './inventory-configs';

// Inventory visualization
export { InventoryVisualizer } from './inventory-visualizer';
export { MaterialStackState } from './material-stack-state';
export type { BuildingVisualState as InventoryVisualState } from './material-stack-state';
export { InventoryLayout } from './inventory-layout';
export type { BuildingLayoutPositions } from './inventory-layout';

// Building pile registry (XML-derived pile positions)
export { BuildingPileRegistry } from './building-pile-registry';
export type { PileSlot, StoragePilePosition } from './building-pile-registry';

// Feature definition (self-registering via FeatureRegistry)
export { InventoryFeature, type InventoryExports } from './inventory-feature';

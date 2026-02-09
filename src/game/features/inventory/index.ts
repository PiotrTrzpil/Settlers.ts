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
 * - Constants: DEFAULT_INPUT_CAPACITY, DEFAULT_OUTPUT_CAPACITY, STORAGE_CAPACITY
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

// Inventory configurations
export type { SlotConfig, InventoryConfig } from './inventory-configs';
export {
    INVENTORY_CONFIGS,
    DEFAULT_INPUT_CAPACITY,
    DEFAULT_OUTPUT_CAPACITY,
    STORAGE_CAPACITY,
    getInventoryConfig,
    hasInventory,
    isProductionBuilding,
    consumesMaterials,
} from './inventory-configs';

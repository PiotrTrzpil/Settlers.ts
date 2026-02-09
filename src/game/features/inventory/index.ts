/**
 * Building Inventory Feature Module
 *
 * Provides inventory management for buildings, tracking input and output material slots.
 *
 * Public API:
 * - Types: InventorySlot, BuildingInventory, InventoryConfig, SlotConfig
 * - Manager: BuildingInventoryManager
 * - Helpers: createSlot, canAccept, canProvide, deposit, withdraw
 * - Config: getInventoryConfig, hasInventory, isProductionBuilding
 * - Constants: DEFAULT_INPUT_CAPACITY, DEFAULT_OUTPUT_CAPACITY, STORAGE_CAPACITY
 */

// Slot types and helpers
export type { InventorySlot } from './inventory-slot';
export {
    createSlot,
    canAccept,
    canProvide,
    deposit,
    withdraw,
    getAvailableSpace,
    isEmpty,
    isFull,
} from './inventory-slot';

// Building inventory manager
export type { BuildingInventory } from './building-inventory';
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

/**
 * Inventory System
 *
 * Core inventory management for buildings: slot state, configs, pile tracking, storage filters.
 * Instantiated directly in game-services.ts (not via feature registry).
 */

import type { BuildingInventoryManager } from './building-inventory';
import type { StorageFilterManager } from './storage-filter-manager';

// Inventory exports interface (used by features that depend on 'inventory' via registerExports)
export interface InventoryExports {
    inventoryManager: BuildingInventoryManager;
    storageFilterManager: StorageFilterManager;
}

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
export type { BuildingInventoryView, BuildingInventoryDeps } from './building-inventory';
export type { MaterialThroughput, SerializedBuildingInventory, SerializedPileSlot } from './building-inventory-helpers';
export { BuildingInventoryManager } from './building-inventory';

// PileSlot type (unified inventory+pile slot)
export type { PileSlot, SlotReservation } from './pile-slot';

// Inventory configurations
export type { SlotConfig, InventoryConfig } from './inventory-configs';
export {
    SLOT_CAPACITY,
    getInventoryConfig,
    getConstructionInventoryConfig,
    hasInventory,
    isProductionBuilding,
    consumesMaterials,
} from './inventory-configs';

// Building pile registry (XML-derived pile positions)
export { BuildingPileRegistry } from './building-pile-registry';
export type { PileSlot as BuildingRegistryPileSlot, StoragePilePosition } from './building-pile-registry';

export { StorageFilterManager, StorageDirection } from './storage-filter-manager';

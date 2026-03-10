/**
 * Inventory System
 *
 * Core inventory management for buildings: slot state, configs, pile tracking, storage filters.
 * Instantiated directly in game-services.ts (not via feature registry).
 */

import type { BuildingInventoryManager } from './building-inventory';
import type { PileRegistry } from './pile-registry';
import type { StorageFilterManager } from './storage-filter-manager';

// Inventory exports interface (used by features that depend on 'inventory' via registerExports)
export interface InventoryExports {
    inventoryManager: BuildingInventoryManager;
    pileRegistry: PileRegistry;
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
export type { BuildingInventory, InventoryChangeCallback } from './building-inventory';
export { BuildingInventoryManager } from './building-inventory';

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
export type { PileSlot, StoragePilePosition } from './building-pile-registry';

// Pile system
export { PileRegistry } from './pile-registry';
export type { PileSlotKey } from './pile-registry';
export { StorageFilterManager } from './storage-filter-manager';
export { PilePositionResolver } from './pile-position-resolver';

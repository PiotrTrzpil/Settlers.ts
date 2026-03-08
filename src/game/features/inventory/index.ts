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
 * - Pile system: PileRegistry, PilePositionResolver, InventoryPileSync, StorageFilterManager
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
export { InventoryPileSync } from './inventory-pile-sync';
export { StorageFilterManager } from './storage-filter-manager';
export { PilePositionResolver } from './pile-position-resolver';
export type { PileKind, LinkedPileKind, LinkedSlotKind } from '../../core/pile-kind';
export { SlotKind, isLinkedPile, getOwnerBuildingId } from '../../core/pile-kind';

// Feature definition (self-registering via FeatureRegistry)
export { InventoryFeature, type InventoryExports } from './inventory-feature';
export { InventoryPileSyncFeature, type InventoryPileSyncExports } from './inventory-pile-sync-feature';

/**
 * Inventory Feature Module — re-exports
 *
 * Core inventory types and managers now live in systems/inventory/.
 * This barrel re-exports them for backward compatibility during migration,
 * plus the pile-sync feature which remains a feature module.
 */

// Re-export everything from the inventory system
export type { InventorySlot, DepositResult, WithdrawResult } from '../../systems/inventory/inventory-slot';
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
} from '../../systems/inventory/inventory-slot';

export type { BuildingInventory, InventoryChangeCallback } from '../../systems/inventory/building-inventory';
export { BuildingInventoryManager } from '../../systems/inventory/building-inventory';

export type { Recipe } from '@/game/economy/building-production';

export type { SlotConfig, InventoryConfig } from '../../systems/inventory/inventory-configs';
export {
    SLOT_CAPACITY,
    getInventoryConfig,
    getConstructionInventoryConfig,
    hasInventory,
    isProductionBuilding,
    consumesMaterials,
} from '../../systems/inventory/inventory-configs';

export { BuildingPileRegistry } from '../../systems/inventory/building-pile-registry';
export type { PileSlot, StoragePilePosition } from '../../systems/inventory/building-pile-registry';

export { PileRegistry } from '../../systems/inventory/pile-registry';
export type { PileSlotKey } from '../../systems/inventory/pile-registry';
export { InventoryPileSync } from './inventory-pile-sync';
export { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
export { PilePositionResolver } from '../../systems/inventory/pile-position-resolver';
export type { PileKind, LinkedPileKind, LinkedSlotKind } from '../../core/pile-kind';
export { SlotKind, isLinkedPile, getOwnerBuildingId } from '../../core/pile-kind';

// Exports type (used by features accessing inventory via ctx.getFeature)
export type { InventoryExports } from '../../systems/inventory';

// Pile sync feature (remains a feature module)
export { InventoryPileSyncFeature, type InventoryPileSyncExports } from './inventory-pile-sync-feature';

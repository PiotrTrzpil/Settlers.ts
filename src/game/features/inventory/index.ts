/**
 * Inventory Feature Module — re-exports
 *
 * Core inventory types and managers now live in systems/inventory/.
 * This barrel re-exports them for convenience, plus the inventory-config
 * feature which wires pile entity management dependencies.
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

export type { BuildingInventoryView, BuildingInventoryDeps } from '../../systems/inventory/building-inventory';
export { BuildingInventoryManager } from '../../systems/inventory/building-inventory';

// Unified slot+pile type (new model)
export type { PileSlot } from '../../systems/inventory/pile-slot';

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
export type { StoragePilePosition } from '../../systems/inventory/building-pile-registry';

export { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
export { PilePositionResolver } from './pile-position-resolver';
export type { PileKind, LinkedPileKind, LinkedSlotKind } from '../../core/pile-kind';
export { SlotKind, isLinkedPile, getOwnerBuildingId } from '../../core/pile-kind';

// Exports type (used by features accessing inventory via ctx.getFeature)
export type { InventoryExports } from '../../systems/inventory';

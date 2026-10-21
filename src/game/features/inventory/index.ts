/**
 * Inventory Feature Module
 *
 * Building inventories (PileSlots), inventory configs, XML pile positions,
 * StorageArea filters and free piles. External code should only import from this file.
 *
 * Public API:
 * - InventoryFeature / InventoryExports (BuildingInventoryManager + StorageFilterManager)
 * - FreePilesFeature (free pile registration + place_pile command)
 * - Slot helpers, inventory configs, pile registries, slot-creation pile positions, pile lookup
 */

// Feature definitions
export { InventoryFeature, type InventoryExports } from './inventory-feature';
export { FreePilesFeature } from './free-piles-feature';

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
export type { BuildingInventoryView, BuildingInventoryDeps, SlotPositionResolver } from './building-inventory';
export type { MaterialThroughput, SerializedBuildingInventory, SerializedPileSlot } from './building-inventory-helpers';
export { BuildingInventoryManager } from './building-inventory';

// Unified slot+pile type and pile lookup side
export type { PileSlot } from './pile-slot';
export type { PileSide } from './pile-lookup';

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

// Pile tile inputs to slot creation: XML pile registry, construction layout, and the resolver
// that fixes PileSlot.position when slots are created
export { BuildingPileRegistry } from './building-pile-registry';
export type { PileSlot as BuildingRegistryPileSlot, StoragePilePosition } from './building-pile-registry';
export { assignConstructionPilePositions } from './construction-pile-positions';
export { PilePositionResolver } from './pile-position-resolver';

// StorageArea filters
export { StorageFilterManager, StorageDirection } from './storage-filter-manager';

// Pile kinds
export type { PileKind, LinkedPileKind, LinkedSlotKind } from '../../core/pile-kind';
export { SlotKind, isLinkedPile, getOwnerBuildingId } from '../../core/pile-kind';

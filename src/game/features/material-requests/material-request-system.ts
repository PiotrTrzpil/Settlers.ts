/**
 * Material Request System - creates transport demands for buildings that need input materials.
 *
 * All production is handled by SettlerTaskSystem via the WORKPLACE work handler.
 * This system's only job is to ensure buildings request materials when their
 * input slots are running low.
 *
 * Uses a dirty-set approach: only re-evaluates buildings whose inventory changed,
 * were just completed, or had a demand fulfilled/cancelled. This avoids iterating
 * all buildings every tick (O(n) → O(dirty)).
 *
 * Demands are slot-agnostic — they express capacity need, not specific slots.
 * Slot assignment happens at job creation time (TransportJobService.activate).
 *
 * Active demand tracking is delegated to DemandQueue + TransportJobStore (single source of truth).
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import { EntityType, BuildingType } from '../../entity';
import { EMaterialType } from '../../economy';
import { DemandPriority, type DemandQueue } from '../logistics/demand-queue';
import type { TransportJobStore } from '../logistics/transport-job-store';
import { getInventoryConfig, type InventoryConfig, type BuildingInventoryManager } from '../inventory';
import { type ConstructionSiteManager } from '../building-construction';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import { EventSubscriptionManager } from '../../event-bus';

/** Maximum concurrent import demands per material per StorageArea (parallel carrier cap). */
const MAX_ACTIVE_IMPORTS_PER_MATERIAL = 20;

/** Configuration for MaterialRequestSystem dependencies */
export interface MaterialRequestSystemConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    inventoryManager: BuildingInventoryManager;
    demandQueue: DemandQueue;
    jobStore: TransportJobStore;
    storageFilterManager: StorageFilterManager;
}

/**
 * System that creates material transport demands for buildings with input slots.
 * Production cycles are handled entirely by SettlerTaskSystem workers.
 *
 * Event-driven dirty-set: buildings are only re-evaluated when their state changes.
 */
export class MaterialRequestSystem implements TickSystem {
    private gameState: GameState;
    private constructionSiteManager: ConstructionSiteManager;
    private inventoryManager: BuildingInventoryManager;
    private demandQueue: DemandQueue;
    private jobStore: TransportJobStore;
    private storageFilterManager: StorageFilterManager;
    private subscriptions = new EventSubscriptionManager();

    /** Buildings that need re-evaluation this tick */
    private dirtyBuildings = new Set<number>();

    /** StorageArea buildings that need re-evaluation this tick */
    private dirtyStorageAreas = new Set<number>();

    /** True on first tick — seeds the dirty set with all operational buildings */
    private needsFullScan = true;

    constructor(config: MaterialRequestSystemConfig) {
        this.gameState = config.gameState;
        this.constructionSiteManager = config.constructionSiteManager;
        this.inventoryManager = config.inventoryManager;
        this.demandQueue = config.demandQueue;
        this.jobStore = config.jobStore;
        this.storageFilterManager = config.storageFilterManager;

        this.subscriptions.subscribe(config.eventBus, 'building:completed', ({ buildingId }) => {
            this.dirtyBuildings.add(buildingId);
            this.dirtyStorageAreas.add(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'building:removed', ({ buildingId }) => {
            this.dirtyBuildings.delete(buildingId);
            this.dirtyStorageAreas.delete(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'inventory:changed', ({ buildingId, slotType }) => {
            if (slotType === 'input') {
                this.dirtyBuildings.add(buildingId);
            }
            // StorageArea output changes affect import capacity
            if (slotType === 'output') {
                this.dirtyStorageAreas.add(buildingId);
            }
        });

        this.subscriptions.subscribe(config.eventBus, 'logistics:demandConsumed', ({ buildingId }) => {
            this.dirtyBuildings.add(buildingId);
            this.dirtyStorageAreas.add(buildingId);
        });

        // When a transport job is cancelled, the building may need new demands.
        // We don't have the destination building readily available from this event,
        // so trigger a full scan (cancellation is rare).
        this.subscriptions.subscribe(config.eventBus, 'carrier:transportCancelled', _payload => {
            this.needsFullScan = true;
        });

        this.subscriptions.subscribe(config.eventBus, 'storage:directionChanged', ({ buildingId }) => {
            this.dirtyStorageAreas.add(buildingId);
        });
    }

    tick(): void {
        if (this.needsFullScan) {
            this.markAllOperationalDirty();
            this.needsFullScan = false;
        }

        for (const buildingId of this.dirtyBuildings) {
            const entity = this.gameState.getEntityOrThrow(buildingId, 'dirty building in material request system');

            const buildingType = entity.subType as BuildingType;
            const config = getInventoryConfig(buildingType, entity.race);

            if (config.inputSlots.length === 0) {
                continue;
            }
            if (this.constructionSiteManager.hasSite(entity.id)) {
                continue;
            }

            this.requestMaterials(entity, config);
        }

        for (const buildingId of this.dirtyStorageAreas) {
            const entity = this.gameState.getEntity(buildingId);
            if (!entity) {
                continue; // Removed during this tick (e.g., free pile consumed by carrier)
            }
            if (this.constructionSiteManager.hasSite(entity.id)) {
                continue;
            }
            this.requestStorageImports(entity.id);
        }

        this.dirtyBuildings.clear();
        this.dirtyStorageAreas.clear();
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Seed the dirty set with all operational buildings that have input slots or are StorageAreas. */
    private markAllOperationalDirty(): void {
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) {
                continue;
            }
            if (this.constructionSiteManager.hasSite(entity.id)) {
                continue;
            }
            if (this.inventoryManager.hasStorageSlots(entity.id)) {
                this.dirtyStorageAreas.add(entity.id);
                continue;
            }
            const buildingType = entity.subType as BuildingType;
            const config = getInventoryConfig(buildingType, entity.race);
            if (config.inputSlots.length === 0) {
                continue;
            }
            this.dirtyBuildings.add(entity.id);
        }
    }

    /**
     * Estimate capacity for a regular building and create slot-agnostic demands.
     * Capacity = sum of (maxCapacity - currentAmount) across typed input slots, minus active demands/jobs.
     */
    private requestMaterials(entity: { id: number }, config: InventoryConfig): void {
        for (const inputSlot of config.inputSlots) {
            // Sum capacity across all input/construction slots for this material
            const totalSpace = this.inventoryManager.getInputSpace(entity.id, inputSlot.materialType);
            if (totalSpace <= 0) {
                continue;
            }

            const activeDemands = this.demandQueue.countDemands(entity.id, inputSlot.materialType);
            const activeJobs = this.jobStore.getActiveJobCountForDest(entity.id, inputSlot.materialType);
            const needed = totalSpace - activeDemands - activeJobs;
            for (let i = 0; i < needed; i++) {
                this.demandQueue.addDemand(entity.id, inputSlot.materialType, 1, DemandPriority.Normal);
            }
        }
    }

    /**
     * Create Low-priority import demands for a StorageArea.
     * Requests the full available capacity so multiple carriers can work in parallel.
     */
    private requestStorageImports(buildingId: number): void {
        const directions = this.storageFilterManager.getDirections(buildingId);
        for (const [material] of directions) {
            if (!this.storageFilterManager.isImportAllowed(buildingId, material)) {
                continue;
            }
            this.requestStorageImportsForMaterial(buildingId, material);
        }
    }

    /**
     * Estimate StorageArea capacity for a material and create slot-agnostic demands.
     *
     * Capacity = (claimedSlots.freeSpace) + (freeSlotCount × SLOT_CAPACITY),
     * capped by MAX_ACTIVE_IMPORTS minus active demands/jobs.
     * Over-estimating is fine — excess demands just won't match at job creation
     * if no slot is available.
     */
    private requestStorageImportsForMaterial(buildingId: number, material: EMaterialType): void {
        const activeDemands = this.demandQueue.countDemands(buildingId, material);
        const activeJobs = this.jobStore.getActiveJobCountForDest(buildingId, material);
        const activeCount = activeDemands + activeJobs;
        if (activeCount >= MAX_ACTIVE_IMPORTS_PER_MATERIAL) {
            return;
        }

        // Estimate available capacity: claimed slots with space + free (NO_MATERIAL) slots
        const slots = this.inventoryManager.getSlots(buildingId);
        if (slots.length === 0) {
            return;
        }

        let estimatedCapacity = 0;
        for (const slot of slots) {
            if (slot.materialType === material) {
                estimatedCapacity += slot.maxCapacity - slot.currentAmount;
            } else if (slot.materialType === EMaterialType.NO_MATERIAL) {
                estimatedCapacity += slot.maxCapacity;
            }
        }
        if (estimatedCapacity <= 0) {
            return;
        }

        const needed = Math.min(estimatedCapacity, MAX_ACTIVE_IMPORTS_PER_MATERIAL - activeCount);
        for (let i = 0; i < needed; i++) {
            this.demandQueue.addDemand(buildingId, material, 1, DemandPriority.Low);
        }
    }
}

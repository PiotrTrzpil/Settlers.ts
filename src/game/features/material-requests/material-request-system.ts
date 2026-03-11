/**
 * Material Request System - creates transport requests for buildings that need input materials.
 *
 * All production is handled by SettlerTaskSystem via the WORKPLACE work handler.
 * This system's only job is to ensure buildings request materials when their
 * input slots are running low.
 *
 * Uses a dirty-set approach: only re-evaluates buildings whose inventory changed,
 * were just completed, or had a request fulfilled/removed. This avoids iterating
 * all buildings every tick (O(n) → O(dirty)).
 *
 * Active request tracking is delegated to the RequestManager (single source of truth).
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import { EntityType, BuildingType } from '../../entity';
import { EMaterialType } from '../../economy';
import { RequestPriority, type RequestManager } from '../logistics';
import { getInventoryConfig, type InventoryConfig, type BuildingInventoryManager } from '../inventory';
import { type ConstructionSiteManager } from '../building-construction';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import { EventSubscriptionManager } from '../../event-bus';

/** Maximum concurrent import requests per material per StorageArea (parallel carrier cap). */
const MAX_ACTIVE_IMPORTS_PER_MATERIAL = 20;

/** Configuration for MaterialRequestSystem dependencies */
export interface MaterialRequestSystemConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    inventoryManager: BuildingInventoryManager;
    requestManager: RequestManager;
    storageFilterManager: StorageFilterManager;
}

/**
 * System that creates material transport requests for buildings with input slots.
 * Production cycles are handled entirely by SettlerTaskSystem workers.
 *
 * Event-driven dirty-set: buildings are only re-evaluated when their state changes.
 */
export class MaterialRequestSystem implements TickSystem {
    private gameState: GameState;
    private constructionSiteManager: ConstructionSiteManager;
    private inventoryManager: BuildingInventoryManager;
    private requestManager: RequestManager;
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
        this.requestManager = config.requestManager;
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

        this.subscriptions.subscribe(config.eventBus, 'logistics:requestFulfilled', ({ buildingId }) => {
            this.dirtyBuildings.add(buildingId);
            this.dirtyStorageAreas.add(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'logistics:requestReset', ({ buildingId }) => {
            this.dirtyBuildings.add(buildingId);
            this.dirtyStorageAreas.add(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'storage:directionChanged', ({ buildingId }) => {
            this.dirtyStorageAreas.add(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'logistics:requestRemoved', _payload => {
            // We don't know which building this was for, but the RequestManager tracks that.
            // Mark all buildings with active requests dirty — this is rare (cancellation).
            // A more targeted approach would require storing requestId→buildingId mapping.
            this.markAllOperationalDirty();
        });
    }

    tick(): void {
        if (this.needsFullScan) {
            this.markAllOperationalDirty();
            this.needsFullScan = false;
        }

        for (const buildingId of this.dirtyBuildings) {
            const entity = this.gameState.getEntity(buildingId);
            if (!entity || entity.type !== EntityType.Building) continue;

            const buildingType = entity.subType as BuildingType;
            const config = getInventoryConfig(buildingType, entity.race);

            if (config.inputSlots.length === 0) continue;
            if (this.constructionSiteManager.hasSite(entity.id)) continue;

            this.requestMaterials(entity, config);
        }

        for (const buildingId of this.dirtyStorageAreas) {
            const entity = this.gameState.getEntity(buildingId);
            if (!entity || entity.type !== EntityType.Building) continue;
            if ((entity.subType as BuildingType) !== BuildingType.StorageArea) continue;
            if (this.constructionSiteManager.hasSite(entity.id)) continue;
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
            if (entity.type !== EntityType.Building) continue;
            if (this.constructionSiteManager.hasSite(entity.id)) continue;
            const buildingType = entity.subType as BuildingType;
            if (buildingType === BuildingType.StorageArea) {
                this.dirtyStorageAreas.add(entity.id);
                continue;
            }
            const config = getInventoryConfig(buildingType, entity.race);
            if (config.inputSlots.length === 0) continue;
            this.dirtyBuildings.add(entity.id);
        }
    }

    private requestMaterials(entity: { id: number }, config: InventoryConfig): void {
        // Buildings with input slots MUST have inventories by design
        const inventory = this.inventoryManager.getInventory(entity.id);
        if (!inventory) {
            throw new Error(`Building ${entity.id} has input slots but no inventory`);
        }

        for (const inputSlot of config.inputSlots) {
            const currentAmount = this.inventoryManager.getInputAmount(entity.id, inputSlot.materialType);
            const space = inputSlot.maxCapacity - currentAmount;
            if (space <= 0) continue;

            const activeCount = this.countActiveRequests(entity.id, inputSlot.materialType);
            const needed = space - activeCount;
            for (let i = 0; i < needed; i++) {
                this.requestManager.addRequest(entity.id, inputSlot.materialType, 1, RequestPriority.Normal);
            }
        }
    }

    /**
     * Create Low-priority import requests for a StorageArea.
     * Requests the full available capacity so multiple carriers can work in parallel.
     */
    private requestStorageImports(buildingId: number): void {
        const directions = this.storageFilterManager.getDirections(buildingId);
        for (const [material] of directions) {
            if (!this.storageFilterManager.isImportAllowed(buildingId, material)) continue;
            const space = this.inventoryManager.getStorageOutputSpace(buildingId, material);
            if (space <= 0) continue;
            const activeCount = this.countActiveRequests(buildingId, material);
            const needed = Math.min(space - activeCount, MAX_ACTIVE_IMPORTS_PER_MATERIAL - activeCount);
            for (let i = 0; i < needed; i++) {
                this.requestManager.addRequest(buildingId, material, 1, RequestPriority.Low);
            }
        }
    }

    /** Count active requests for a building+material. */
    private countActiveRequests(buildingId: number, materialType: EMaterialType): number {
        const requests = this.requestManager.getRequestsForBuilding(buildingId);
        return requests.filter(r => r.materialType === materialType).length;
    }
}

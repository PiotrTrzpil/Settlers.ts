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

import type { TickSystem } from '../../tick-system';
import type { GameState } from '../../game-state';
import { EntityType, BuildingType } from '../../entity';
import { EMaterialType } from '../../economy';
import { RequestPriority, type RequestManager } from '../logistics';
import { getInventoryConfig, type InventoryConfig, type BuildingInventoryManager } from '../inventory';
import { type ConstructionSiteManager } from '../building-construction';
import { EventSubscriptionManager, type EventBus } from '../../event-bus';

/** Minimum input threshold before requesting more materials */
const REQUEST_THRESHOLD = 4;

/** Configuration for MaterialRequestSystem dependencies */
export interface MaterialRequestSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
    constructionSiteManager: ConstructionSiteManager;
    inventoryManager: BuildingInventoryManager;
    requestManager: RequestManager;
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
    private subscriptions = new EventSubscriptionManager();

    /** Buildings that need re-evaluation this tick */
    private dirtyBuildings = new Set<number>();

    /** True on first tick — seeds the dirty set with all operational buildings */
    private needsFullScan = true;

    constructor(config: MaterialRequestSystemConfig) {
        this.gameState = config.gameState;
        this.constructionSiteManager = config.constructionSiteManager;
        this.inventoryManager = config.inventoryManager;
        this.requestManager = config.requestManager;

        this.subscriptions.subscribe(config.eventBus, 'building:completed', ({ entityId }) => {
            this.dirtyBuildings.add(entityId);
        });

        this.subscriptions.subscribe(config.eventBus, 'building:removed', ({ entityId }) => {
            this.dirtyBuildings.delete(entityId);
        });

        this.subscriptions.subscribe(config.eventBus, 'inventory:changed', ({ buildingId, slotType }) => {
            if (slotType === 'input') {
                this.dirtyBuildings.add(buildingId);
            }
        });

        this.subscriptions.subscribe(config.eventBus, 'logistics:requestFulfilled', ({ buildingId }) => {
            this.dirtyBuildings.add(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'logistics:requestReset', ({ buildingId }) => {
            this.dirtyBuildings.add(buildingId);
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

        this.dirtyBuildings.clear();
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Seed the dirty set with all operational buildings that have input slots. */
    private markAllOperationalDirty(): void {
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) continue;
            const config = getInventoryConfig(entity.subType as BuildingType, entity.race);
            if (config.inputSlots.length === 0) continue;
            if (this.constructionSiteManager.hasSite(entity.id)) continue;
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

            // Request more if below threshold and no active request in the RequestManager
            if (currentAmount < REQUEST_THRESHOLD && !this.hasActiveRequest(entity.id, inputSlot.materialType)) {
                this.requestManager.addRequest(entity.id, inputSlot.materialType, 1, RequestPriority.Normal);
            }
        }
    }

    /** Check if there's already an active (pending or in-progress) request for this building+material */
    private hasActiveRequest(buildingId: number, materialType: EMaterialType): boolean {
        const requests = this.requestManager.getRequestsForBuilding(buildingId);
        return requests.some(r => r.materialType === materialType);
    }
}

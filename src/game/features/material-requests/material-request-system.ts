/**
 * Material Request System — maintains standing orders (DemandLedger targets)
 * for buildings that receive materials.
 *
 * With the declarative ledger there is nothing to re-scan per tick: a
 * building's standing orders are set once when it becomes operational and
 * removed when it disappears. The actual shortfall is derived by the
 * dispatcher from live inventory + transport jobs (demand-deficit.ts), so
 * inventory changes, cancelled jobs, and consumed materials never need
 * event-driven re-requesting here.
 *
 * - Production buildings: one capacity-fill order per input material (Normal).
 * - StorageAreas: one capped capacity-fill order per import-enabled material (Low).
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import { EntityType, BuildingType } from '../../entity';
import { DemandPriority, type DemandLedger } from '../logistics/demand-ledger';
import { getInventoryConfig, type BuildingInventoryManager } from '../inventory';
import { type ConstructionSiteManager } from '../building-construction';
import { StorageDirection, type StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import { EventSubscriptionManager } from '../../event-bus';

/** Maximum concurrent incoming import jobs per material per StorageArea (parallel carrier cap). */
const MAX_ACTIVE_IMPORTS_PER_MATERIAL = 20;

/** Configuration for MaterialRequestSystem dependencies */
export interface MaterialRequestSystemConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    inventoryManager: BuildingInventoryManager;
    demandLedger: DemandLedger;
    storageFilterManager: StorageFilterManager;
}

/**
 * Keeps the DemandLedger's standing orders in sync with the set of operational
 * buildings. Event-driven; the only tick work is the one-time initial seeding.
 */
export class MaterialRequestSystem implements TickSystem {
    private gameState: GameState;
    private constructionSiteManager: ConstructionSiteManager;
    private inventoryManager: BuildingInventoryManager;
    private demandLedger: DemandLedger;
    private storageFilterManager: StorageFilterManager;
    private subscriptions = new EventSubscriptionManager();

    /** True until the first tick seeds orders for all pre-existing buildings. */
    private needsSeeding = true;

    constructor(config: MaterialRequestSystemConfig) {
        this.gameState = config.gameState;
        this.constructionSiteManager = config.constructionSiteManager;
        this.inventoryManager = config.inventoryManager;
        this.demandLedger = config.demandLedger;
        this.storageFilterManager = config.storageFilterManager;

        this.subscriptions.subscribe(config.eventBus, 'building:completed', ({ buildingId }) => {
            // Construction orders (if any) are stale now — replace with operational orders.
            this.demandLedger.clearBuilding(buildingId);
            this.setOrdersForBuilding(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'building:removed', ({ buildingId }) => {
            this.demandLedger.clearBuilding(buildingId);
        });

        this.subscriptions.subscribe(config.eventBus, 'storage:directionChanged', ({ buildingId }) => {
            this.syncStorageOrders(buildingId);
        });
    }

    tick(): void {
        if (!this.needsSeeding) {
            return;
        }
        this.needsSeeding = false;
        for (const entity of this.gameState.entityIndex.query(EntityType.Building)) {
            if (!this.constructionSiteManager.hasSite(entity.id)) {
                this.setOrdersForBuilding(entity.id);
            }
        }
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Set standing orders for an operational building (production inputs or storage imports). */
    private setOrdersForBuilding(buildingId: number): void {
        if (this.inventoryManager.hasStorageSlots(buildingId)) {
            this.syncStorageOrders(buildingId);
            return;
        }

        const entity = this.gameState.getEntityOrThrow(buildingId, 'building in material request seeding');
        const config = getInventoryConfig(entity.subType as BuildingType, entity.race);
        for (const inputSlot of config.inputSlots) {
            this.demandLedger.setTarget(buildingId, inputSlot.materialType, {
                priority: DemandPriority.Normal,
            });
        }
    }

    /**
     * Sync a StorageArea's import orders with its direction config:
     * one capped capacity-fill order per import-enabled material,
     * orders removed for materials no longer importable.
     */
    private syncStorageOrders(buildingId: number): void {
        if (this.constructionSiteManager.hasSite(buildingId)) {
            return; // Imports start once construction completes
        }
        const directions = this.storageFilterManager.getDirections(buildingId);

        for (const order of this.demandLedger.getTargetsForBuilding(buildingId)) {
            if (!this.storageFilterManager.isImportAllowed(buildingId, order.materialType)) {
                this.demandLedger.clearTarget(buildingId, order.materialType);
            }
        }

        for (const [material, direction] of directions) {
            if (direction === StorageDirection.Import || direction === StorageDirection.Both) {
                this.demandLedger.setTarget(buildingId, material, {
                    priority: DemandPriority.Low,
                    maxIncoming: MAX_ACTIVE_IMPORTS_PER_MATERIAL,
                });
            }
        }
    }
}

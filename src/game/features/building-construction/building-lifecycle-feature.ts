/**
 * BuildingLifecycleHandler — domain event handlers for building placement,
 * completion, and construction delivery tracking.
 *
 * Extracted from GameServices to keep the composition root free of domain logic.
 * Purely event-driven (no tick). Subscribes to:
 *   - building:placed
 *   - building:completed
 *   - inventory:changed (input increase → construction delivery tracking)
 *
 * Registers entity cleanup for construction site removal.
 *
 * NOTE: Production control init and barracks init are handled by their
 * respective features (ProductionControlFeature, BarracksFeature).
 */

import { type EventBus, EventSubscriptionManager, type GameEvents } from '../../event-bus';
import type { CoreDeps } from '../feature';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { BuildingInventoryManager } from '../inventory';
import { getConstructionInventoryConfig } from '../inventory';
import type { GameState } from '../../game-state';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';

export interface BuildingLifecycleConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    inventoryManager: BuildingInventoryManager;
    cleanupRegistry: EntityCleanupRegistry;
}

export class BuildingLifecycleHandler {
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly cleanupRegistry: EntityCleanupRegistry;

    constructor(config: BuildingLifecycleConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.constructionSiteManager = config.constructionSiteManager;
        this.inventoryManager = config.inventoryManager;
        this.cleanupRegistry = config.cleanupRegistry;
    }

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'building:placed', this.onBuildingPlaced.bind(this));
        this.subscriptions.subscribe(this.eventBus, 'building:completed', this.onBuildingCompleted.bind(this));
        this.subscriptions.subscribe(this.eventBus, 'inventory:changed', this.onInventoryChanged.bind(this));
        this.subscriptions.subscribe(
            this.eventBus,
            'construction:materialOverflowed',
            this.onMaterialOverflowed.bind(this)
        );

        this.cleanupRegistry.onEntityRemoved(
            this.constructionSiteManager.removeSite.bind(this.constructionSiteManager)
        );
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    private onBuildingPlaced({ buildingId, buildingType, x, y, player }: GameEvents['building:placed']): void {
        const entity = this.gameState.getEntity(buildingId);
        if (!entity) return;
        this.constructionSiteManager.registerSite(buildingId, buildingType, entity.race, player, x, y);
        const constructionConfig = getConstructionInventoryConfig(buildingType, entity.race);
        if (constructionConfig.inputSlots.length > 0) {
            this.inventoryManager.createInventoryFromConfig(buildingId, buildingType, constructionConfig);
        }
    }

    private onBuildingCompleted({ buildingId, buildingType, race }: GameEvents['building:completed']): void {
        this.inventoryManager.swapInventoryPhase(buildingId, buildingType, race);
        this.constructionSiteManager.removeSite(buildingId);
    }

    private onMaterialOverflowed({
        buildingId,
        material,
        amount,
    }: GameEvents['construction:materialOverflowed']): void {
        const site = this.constructionSiteManager.getSite(buildingId);
        if (!site) return;
        this.constructionSiteManager.recordDelivery(buildingId, material, amount);
    }

    private onInventoryChanged({
        buildingId,
        materialType,
        slotType,
        newAmount,
        previousAmount,
    }: GameEvents['inventory:changed']): void {
        if (slotType === 'input' && newAmount > previousAmount) {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (site) {
                const deposited = newAmount - previousAmount;
                this.constructionSiteManager.recordDelivery(buildingId, materialType, deposited);
                this.eventBus.emit('construction:materialDelivered', { buildingId, material: materialType });
            }
        }
    }
}

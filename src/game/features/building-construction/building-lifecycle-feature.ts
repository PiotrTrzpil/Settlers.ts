/**
 * BuildingLifecycleHandler — domain event handlers for building placement and completion.
 *
 * Extracted from GameServices to keep the composition root free of domain logic.
 * Purely event-driven (no tick). Subscribes to:
 *   - building:placed
 *   - building:completed
 *
 * Registers entity cleanup for construction site removal.
 *
 * Pile tiles are decided here, once, at slot creation: construction slots use the
 * PilePositionResolver's door-adjacent construction layout, operational slots its XML
 * pile layout. Runtime consumers read PileSlot.position via the inventory lookup.
 */

import { type EventBus, EventSubscriptionManager, type GameEvents } from '../../event-bus';
import type { CoreDeps } from '../feature';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { BuildingInventoryManager } from '../inventory';
import { getConstructionInventoryConfig } from '../inventory';
import type { GameState } from '../../game-state';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { PilePositionResolver } from '../inventory';

export interface BuildingLifecycleConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    inventoryManager: BuildingInventoryManager;
    cleanupRegistry: EntityCleanupRegistry;
    pilePositionResolver: PilePositionResolver;
}

export class BuildingLifecycleHandler {
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly cleanupRegistry: EntityCleanupRegistry;
    private readonly pilePositions: PilePositionResolver;

    constructor(config: BuildingLifecycleConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.constructionSiteManager = config.constructionSiteManager;
        this.inventoryManager = config.inventoryManager;
        this.cleanupRegistry = config.cleanupRegistry;
        this.pilePositions = config.pilePositionResolver;
    }

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'building:placed', this.onBuildingPlaced.bind(this));
        this.subscriptions.subscribe(this.eventBus, 'building:completed', this.onBuildingCompleted.bind(this));

        this.cleanupRegistry.onEntityRemoved(
            this.constructionSiteManager.removeSite.bind(this.constructionSiteManager)
        );
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    private onBuildingPlaced({ buildingId, buildingType, x, y, player }: GameEvents['building:placed']): void {
        const entity = this.gameState.getEntityOrThrow(buildingId, 'building placed event target');
        this.constructionSiteManager.registerSite(buildingId, buildingType, entity.race, player, x, y);
        if (getConstructionInventoryConfig(buildingType, entity.race).inputSlots.length > 0) {
            this.inventoryManager.createConstructionSlots(
                buildingId,
                buildingType,
                entity.race,
                this.pilePositions.construction
            );
        }
    }

    private onBuildingCompleted({ buildingId, buildingType, race }: GameEvents['building:completed']): void {
        this.gameState.getEntityOrThrow(buildingId, 'building:completed').operational = true;
        this.constructionSiteManager.removeSite(buildingId);

        // Construction slots should be fully consumed by builders before completion.
        const leftover = this.inventoryManager.getSlots(buildingId).filter(s => s.currentAmount > 0);
        if (leftover.length > 0) {
            throw new Error(
                `building:completed #${buildingId}: ${leftover.length} construction slots still have materials`
            );
        }

        this.inventoryManager.destroySlots(buildingId);
        this.inventoryManager.createSlots(buildingId, buildingType, race, this.pilePositions.operational);
    }
}

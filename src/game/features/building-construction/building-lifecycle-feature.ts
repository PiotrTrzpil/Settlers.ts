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
 * Position resolution is provided by PilePositionResolver, injected at construction time.
 * The handler builds a SlotPositionResolver callback from it, which is passed to the
 * inventory manager on each slot-creation call.
 */

import { type EventBus, EventSubscriptionManager, type GameEvents } from '../../event-bus';
import type { CoreDeps } from '../feature';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { BuildingInventoryManager, SlotPositionResolver } from '../../systems/inventory/building-inventory';
import { getConstructionInventoryConfig } from '../inventory';
import type { GameState } from '../../game-state';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { PilePositionResolver } from '../inventory/pile-position-resolver';
import type { Entity } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { LinkedSlotKind } from '../../core/pile-kind';

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
    private readonly positionResolver: SlotPositionResolver;

    constructor(config: BuildingLifecycleConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.constructionSiteManager = config.constructionSiteManager;
        this.inventoryManager = config.inventoryManager;
        this.cleanupRegistry = config.cleanupRegistry;
        this.positionResolver = this.buildPositionResolver(config.pilePositionResolver);
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

    private buildPositionResolver(resolver: PilePositionResolver): SlotPositionResolver {
        return (
            buildingId: number,
            building: Entity,
            configs: ReadonlyArray<{ materialType: EMaterialType; kind: SlotKind }>
        ) => {
            const usedPositions = new Set<string>();
            const pileIndexByMaterial = new Map<EMaterialType, number>();

            return configs.map(cfg => {
                const pileIndex = pileIndexByMaterial.get(cfg.materialType) ?? 0;
                pileIndexByMaterial.set(cfg.materialType, pileIndex + 1);

                const position = resolver.resolvePosition({
                    buildingId,
                    building,
                    material: cfg.materialType,
                    slotKind: cfg.kind as LinkedSlotKind,
                    usedPositions,
                    pileIndex,
                });
                if (position) {
                    usedPositions.add(`${position.x},${position.y}`);
                }
                return position;
            });
        };
    }

    private onBuildingPlaced({ buildingId, buildingType, x, y, player }: GameEvents['building:placed']): void {
        const entity = this.gameState.getEntity(buildingId);
        if (!entity) {
            return;
        }
        this.constructionSiteManager.registerSite(buildingId, buildingType, entity.race, player, x, y);
        const constructionConfig = getConstructionInventoryConfig(buildingType, entity.race);
        if (constructionConfig.inputSlots.length > 0) {
            this.inventoryManager.createSlotsFromConfig(
                buildingId,
                buildingType,
                constructionConfig,
                this.positionResolver
            );
        }
    }

    private onBuildingCompleted({ buildingId, buildingType, race }: GameEvents['building:completed']): void {
        this.constructionSiteManager.removeSite(buildingId);

        // Construction slots should be fully consumed by builders before completion.
        const leftover = this.inventoryManager.getSlots(buildingId).filter(s => s.currentAmount > 0);
        if (leftover.length > 0) {
            throw new Error(
                `building:completed #${buildingId}: ${leftover.length} construction slots still have materials`
            );
        }

        this.inventoryManager.destroySlots(buildingId);
        this.inventoryManager.createSlots(buildingId, buildingType, race, this.positionResolver);
    }
}

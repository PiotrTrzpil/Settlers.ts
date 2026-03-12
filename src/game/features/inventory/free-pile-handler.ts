/**
 * FreePileHandler — domain event handlers for free pile creation.
 *
 * Extracted from GameServices to keep the composition root free of domain logic.
 * Purely event-driven (no tick). Subscribes to:
 *   - pile:freePilePlaced — territory ownership + PileSlot registration
 *
 * In the new model, a free pile IS a PileSlot with kind=Free. The BuildingInventoryManager
 * owns pile entity lifecycle (quantity updates and removal at zero) — no sync listener needed.
 */

import { type EventBus, EventSubscriptionManager, type GameEvents } from '../../event-bus';
import type { CoreDeps } from '../feature';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { GameState } from '../../game-state';
import type { TerritoryManager } from '../territory';

export interface FreePileConfig extends CoreDeps {
    inventoryManager: BuildingInventoryManager;
    getTerritoryManager: () => TerritoryManager;
}

export class FreePileHandler {
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly getTerritoryManager: () => TerritoryManager;

    constructor(config: FreePileConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.inventoryManager = config.inventoryManager;
        this.getTerritoryManager = config.getTerritoryManager;
    }

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'pile:freePilePlaced', this.onFreePilePlaced.bind(this));
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    private onFreePilePlaced({ entityId, materialType, quantity }: GameEvents['pile:freePilePlaced']): void {
        const entity = this.gameState.getEntityOrThrow(entityId, 'onFreePilePlaced');

        // Assign ownership based on territory — free piles belong to whoever controls the land.
        if (entity.player === 0) {
            const owner = this.getTerritoryManager().getOwner(entity.x, entity.y);
            if (owner >= 0) {
                entity.player = owner;
            }
        }

        // Register as a free PileSlot — the entity already exists, manager links it to the slot.
        // The logistics system discovers free piles via getOutputAmount(entityId, material).
        this.inventoryManager.registerFreePile(entityId, materialType, quantity, { x: entity.x, y: entity.y });
    }
}

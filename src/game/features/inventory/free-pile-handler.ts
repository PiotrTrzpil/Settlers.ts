/**
 * FreePileHandler — domain event handlers for free pile creation and depletion.
 *
 * Extracted from GameServices to keep the composition root free of domain logic.
 * Purely event-driven (no tick). Subscribes to:
 *   - pile:freePilePlaced — territory ownership + inventory registration + initial deposit
 *   - inventory:changed — output decrease on StackedPile entities → quantity sync + removal
 */

import { type EventBus, EventSubscriptionManager, type GameEvents } from '../../event-bus';
import type { CoreDeps } from '../feature';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { GameState } from '../../game-state';
import type { TerritoryManager } from '../territory';
import { EntityType } from '../../entity';
import { BuildingType } from '../../buildings/types';

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
        this.subscriptions.subscribe(this.eventBus, 'inventory:changed', this.onInventoryChanged.bind(this));
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

        // Register an output-only inventory so the logistics system can discover and pick up free piles.
        this.inventoryManager.createInventoryFromConfig(entityId, BuildingType.StorageArea, {
            inputSlots: [],
            outputSlots: [{ materialType, maxCapacity: quantity }],
        });
        this.inventoryManager.depositOutput(entityId, materialType, quantity);
    }

    private onInventoryChanged({
        buildingId,
        slotType,
        newAmount,
        previousAmount,
    }: GameEvents['inventory:changed']): void {
        // Free pile sync: when output is withdrawn, update pile quantity and remove if depleted
        if (slotType === 'output' && newAmount < previousAmount) {
            const entity = this.gameState.getEntity(buildingId);
            if (entity?.type === EntityType.StackedPile) {
                this.gameState.piles.setQuantity(buildingId, newAmount);
                if (newAmount === 0) {
                    this.gameState.removeEntity(buildingId);
                }
            }
        }
    }
}

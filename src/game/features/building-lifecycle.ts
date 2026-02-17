/**
 * Building Lifecycle Coordinator
 *
 * Owns the building:created and entity:removed event subscriptions and handles
 * the standard creation/removal sequence: service areas, inventories, construction state.
 *
 * GameLoop passes managers at construction time; BuildingLifecycle knows the ordering.
 * Additional hooks are available via onCreated/onRemoved for extensibility.
 *
 * Public API:
 * - BuildingLifecycle - coordinator class
 * - BuildingLifecycleConfig - constructor config
 * - BuildingCreatedHandler, EntityRemovedHandler - hook types
 */

import type { GameState } from '../game-state';
import type { EventBus } from '../event-bus';
import { EventSubscriptionManager } from '../event-bus';
import { BuildingType } from '../entity';
import type { BuildingInventoryManager } from './inventory';
import { hasInventory, isProductionBuilding } from './inventory';
import type { ServiceAreaManager } from './service-areas';
import type { BuildingStateManager } from './building-construction';
import type { CarrierManager } from './carriers';
import type { LogisticsDispatcher } from './logistics';
import type { InventoryVisualizer } from './inventory';

export type BuildingCreatedHandler = (
    entityId: number,
    buildingType: BuildingType,
    x: number,
    y: number,
    player: number
) => void;

export type EntityRemovedHandler = (entityId: number) => void;

export interface BuildingLifecycleConfig {
    gameState: GameState;
    eventBus: EventBus;
    serviceAreaManager: ServiceAreaManager;
    inventoryManager: BuildingInventoryManager;
    buildingStateManager: BuildingStateManager;
    carrierManager: CarrierManager;
    logisticsDispatcher: LogisticsDispatcher;
    inventoryVisualizer: InventoryVisualizer;
}

/**
 * Building types that act as logistics hubs (taverns/carrier bases).
 * These buildings get service areas when created.
 */
const SERVICE_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.ResidenceSmall,
    BuildingType.ResidenceMedium,
    BuildingType.ResidenceBig,
]);

export class BuildingLifecycle {
    private readonly extraCreatedHandlers: BuildingCreatedHandler[] = [];
    private readonly extraRemovedHandlers: EntityRemovedHandler[] = [];
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly gameState: GameState;
    private readonly serviceAreaManager: ServiceAreaManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly buildingStateManager: BuildingStateManager;
    private readonly carrierManager: CarrierManager;
    private readonly logisticsDispatcher: LogisticsDispatcher;
    private readonly inventoryVisualizer: InventoryVisualizer;

    constructor(config: BuildingLifecycleConfig) {
        this.gameState = config.gameState;
        this.serviceAreaManager = config.serviceAreaManager;
        this.inventoryManager = config.inventoryManager;
        this.buildingStateManager = config.buildingStateManager;
        this.carrierManager = config.carrierManager;
        this.logisticsDispatcher = config.logisticsDispatcher;
        this.inventoryVisualizer = config.inventoryVisualizer;

        this.subscriptions.subscribe(config.eventBus, 'building:created', ({ entityId, buildingType, x, y }) => {
            const entity = this.gameState.getEntityOrThrow(entityId, 'building lifecycle: created');
            this.handleCreated(entityId, buildingType, x, y, entity.player);
        });

        this.subscriptions.subscribe(config.eventBus, 'entity:removed', ({ entityId }) => {
            this.handleRemoved(entityId);
        });
    }

    /** Register an additional creation handler (called after built-in handlers). */
    onCreated(handler: BuildingCreatedHandler): void {
        this.extraCreatedHandlers.push(handler);
    }

    /** Register an additional removal handler (called after built-in handlers). */
    onRemoved(handler: EntityRemovedHandler): void {
        this.extraRemovedHandlers.push(handler);
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
        this.extraCreatedHandlers.length = 0;
        this.extraRemovedHandlers.length = 0;
    }

    // ── Built-in lifecycle handling ─────────────────────────────────────

    private handleCreated(entityId: number, buildingType: BuildingType, x: number, y: number, player: number): void {
        // Create service area for logistics hubs (taverns/warehouses)
        if (SERVICE_AREA_BUILDINGS.has(buildingType)) {
            this.serviceAreaManager.createServiceArea(entityId, player, x, y, buildingType);
        }

        // Create inventory for buildings with input/output slots
        if (hasInventory(buildingType) || isProductionBuilding(buildingType)) {
            this.inventoryManager.createInventory(entityId, buildingType);
        }

        // Create building construction state
        this.buildingStateManager.createBuildingState(entityId, buildingType, x, y);

        // Run any extra registered handlers
        for (const handler of this.extraCreatedHandlers) {
            handler(entityId, buildingType, x, y, player);
        }
    }

    private handleRemoved(entityId: number): void {
        // Clean up carrier state if this was a carrier
        if (this.carrierManager.hasCarrier(entityId)) {
            this.carrierManager.removeCarrier(entityId);
        }

        // Clean up service area if this building had one
        this.serviceAreaManager.removeServiceArea(entityId);

        // Clean up logistics state first (releasing reservations needs the inventory)
        this.logisticsDispatcher.handleBuildingDestroyed(entityId);

        // Clean up inventory after logistics is done with it
        this.inventoryManager.removeInventory(entityId);

        // Clean up visual inventory stacks
        this.inventoryVisualizer.removeBuilding(entityId);

        // Run any extra registered handlers
        for (const handler of this.extraRemovedHandlers) {
            handler(entityId);
        }
    }
}

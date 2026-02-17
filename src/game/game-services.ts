/**
 * GameServices — composition root for all game managers and systems.
 *
 * Creates, wires, and owns every domain manager and tick system.
 * GameLoop (frame scheduling) and Game (public façade) depend on this;
 * this module knows nothing about either of them.
 */

import { GameState } from './game-state';
import { MovementSystem } from './systems/movement/index';
import { SettlerTaskSystem, SearchType } from './features/settler-tasks';
import {
    createWoodcuttingHandler,
    createStonecuttingHandler,
    createForesterHandler,
} from './features/settler-tasks/work-handlers';
import { MaterialRequestFeature } from './features/material-requests';
import type { TerrainData } from './terrain';
import type { TickSystem } from './tick-system';
import { BuildingConstructionSystem, BuildingStateManager } from './features/building-construction';
import { CarrierManager } from './features/carriers';
import {
    InventoryVisualizer,
    BuildingInventoryManager,
    hasInventory,
    isProductionBuilding,
} from './features/inventory';
import { LogisticsDispatcher, RequestManager } from './features/logistics';
import { ServiceAreaManager } from './features/service-areas';
import { FeatureRegistry } from './features/feature-registry';
import { TreeFeature, TreeSystem, type TreeFeatureExports } from './features/trees';
import { EventBus, EventSubscriptionManager } from './event-bus';
import { BuildingType, UnitType } from './entity';
import { AnimationService } from './animation/index';

type BuildingCreatedHandler = (
    entityId: number,
    buildingType: BuildingType,
    x: number,
    y: number,
    player: number
) => void;
type EntityRemovedHandler = (entityId: number) => void;

/**
 * Building types that act as logistics hubs (taverns/carrier bases).
 * These buildings get service areas when created.
 */
const SERVICE_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.ResidenceSmall,
    BuildingType.ResidenceMedium,
    BuildingType.ResidenceBig,
]);
import type { Command, CommandResult } from './commands';

export class GameServices {
    // ===== Animation =====
    /** Animation service — manages entity animations */
    public readonly animationService: AnimationService;

    // ===== Managers (own state, no tick) =====
    /** Carrier manager — tracks carrier state and assignments */
    public readonly carrierManager: CarrierManager;

    /** Building inventory manager — tracks building input/output slots */
    public readonly inventoryManager: BuildingInventoryManager;

    /** Service area manager — tracks logistics service areas */
    public readonly serviceAreaManager: ServiceAreaManager;

    /** Request manager — tracks material delivery requests */
    public readonly requestManager: RequestManager;

    /** Building state manager — tracks construction state for all buildings */
    public readonly buildingStateManager: BuildingStateManager;

    // ===== Systems (tick each frame) =====
    /** Movement system — updates unit positions */
    public readonly movement: MovementSystem;

    /** Building construction system — terrain modification, phase transitions */
    public readonly constructionSystem: BuildingConstructionSystem;

    /** Settler task system — manages all settler behaviors */
    public readonly settlerTaskSystem: SettlerTaskSystem;

    /** Logistics dispatcher — connects resource requests to carriers */
    public readonly logisticsDispatcher!: LogisticsDispatcher;

    /** Inventory visualizer — syncs building outputs to visual stacked resources */
    public readonly inventoryVisualizer: InventoryVisualizer;

    /** Tree lifecycle system — growth and cutting states */
    public readonly treeSystem: TreeSystem;

    // ===== Internal =====
    private readonly extraCreatedHandlers: BuildingCreatedHandler[] = [];
    private readonly extraRemovedHandlers: EntityRemovedHandler[] = [];
    private readonly featureRegistry: FeatureRegistry;
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly eventBus: EventBus;
    private readonly tickSystems: TickSystem[] = [];

    constructor(gameState: GameState, eventBus: EventBus, executeCommand: (cmd: Command) => CommandResult) {
        this.eventBus = eventBus;

        // 1. Animation service — other systems depend on it
        this.animationService = new AnimationService();

        // 2. Managers
        this.carrierManager = new CarrierManager({
            entityProvider: gameState,
            eventBus,
        });
        this.inventoryManager = new BuildingInventoryManager();
        this.serviceAreaManager = new ServiceAreaManager();
        this.requestManager = new RequestManager();
        this.buildingStateManager = new BuildingStateManager({
            entityProvider: gameState,
            eventBus,
        });

        // 3. Movement system
        this.movement = new MovementSystem({
            eventBus,
            rng: gameState.rng,
            updatePosition: (id, x, y) => {
                gameState.updateEntityPosition(id, x, y);
                return true;
            },
            getEntity: id => gameState.getEntity(id),
        });
        this.movement.setTileOccupancy(gameState.tileOccupancy);
        gameState.setMovementSystem(this.movement);
        this.addSystem(this.movement);

        // 4. Building construction system
        this.constructionSystem = new BuildingConstructionSystem({
            gameState,
            buildingStateManager: this.buildingStateManager,
            executeCommand,
        });
        this.constructionSystem.registerEvents(eventBus);
        this.addSystem(this.constructionSystem);

        // 5. Carrier manager (also a TickSystem for fatigue recovery)
        this.carrierManager.setServiceAreaManager(this.serviceAreaManager);
        this.addSystem(this.carrierManager);

        // Auto-register carriers on spawn
        this.subscriptions.subscribe(eventBus, 'unit:spawned', payload => {
            if (payload.unitType === UnitType.Carrier) {
                this.carrierManager.autoRegisterCarrier(payload.entityId, payload.x, payload.y, payload.player);
            }
        });

        // 6. Feature registry — load self-registering features
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            animationService: this.animationService,
        });

        // Bridge manually-created managers so registry features can access them
        this.featureRegistry.registerExports('building-construction', {
            buildingStateManager: this.buildingStateManager,
        });
        this.featureRegistry.registerExports('inventory', { inventoryManager: this.inventoryManager });
        this.featureRegistry.registerExports('logistics', { requestManager: this.requestManager });

        this.featureRegistry.loadAll([TreeFeature, MaterialRequestFeature]);
        this.treeSystem = this.featureRegistry.getFeatureExports<TreeFeatureExports>('trees').treeSystem;
        this.treeSystem.setCommandExecutor(executeCommand);
        for (const system of this.featureRegistry.getSystems()) {
            this.addSystem(system);
        }

        // 7. Settler task system
        this.settlerTaskSystem = new SettlerTaskSystem({
            gameState,
            animationService: this.animationService,
            inventoryManager: this.inventoryManager,
            carrierManager: this.carrierManager,
            eventBus,
            getInventoryVisualizer: () => this.inventoryVisualizer,
        });
        this.addSystem(this.settlerTaskSystem);

        // 8. Logistics dispatcher
        this.logisticsDispatcher = new LogisticsDispatcher({
            gameState,
            carrierManager: this.carrierManager,
            settlerTaskSystem: this.settlerTaskSystem,
            requestManager: this.requestManager,
            serviceAreaManager: this.serviceAreaManager,
            inventoryManager: this.inventoryManager,
        });
        this.logisticsDispatcher.registerEvents(eventBus);
        this.addSystem(this.logisticsDispatcher);

        // 9. Work handlers
        this.settlerTaskSystem.registerWorkHandler(
            SearchType.TREE,
            createWoodcuttingHandler(gameState, this.treeSystem)
        );
        this.settlerTaskSystem.registerWorkHandler(SearchType.STONE, createStonecuttingHandler(gameState));
        this.settlerTaskSystem.registerWorkHandler(SearchType.TREE_SEED_POS, createForesterHandler(this.treeSystem));

        // 10. Inventory visualizer
        this.inventoryVisualizer = new InventoryVisualizer(gameState, this.inventoryManager, executeCommand);

        // 12. Building lifecycle — subscribe to creation/removal events
        this.subscriptions.subscribe(eventBus, 'building:created', ({ entityId, buildingType, x, y }) => {
            const entity = gameState.getEntityOrThrow(entityId, 'building lifecycle: created');
            this.handleBuildingCreated(entityId, buildingType, x, y, entity.player);
        });
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            this.handleEntityRemoved(entityId);
        });

        // 13. Bridge inventory changes to EventBus for consumers (debug panel, UI)
        this.inventoryManager.onChange((buildingId, materialType, slotType, previousAmount, newAmount) => {
            this.eventBus.emit('inventory:changed', {
                buildingId,
                materialType,
                slotType,
                previousAmount,
                newAmount,
            });
        });

        // 14. Bridge request creation to EventBus for consumers (debug panel, UI)
        this.requestManager.on('requestAdded', ({ request }) => {
            this.eventBus.emit('request:created', {
                requestId: request.id,
                buildingId: request.buildingId,
                materialType: request.materialType,
                amount: request.amount,
                priority: request.priority,
            });
        });
    }

    /** Provide terrain data to movement and construction systems */
    public setTerrainData(terrain: TerrainData): void {
        this.movement.setTerrainData(terrain.groundType, terrain.groundHeight, terrain.width, terrain.height);
        this.constructionSystem.setTerrainContext({
            terrain,
            onTerrainModified: () => this.eventBus.emit('terrain:modified', {}),
        });
    }

    /** Ordered tick systems for the frame loop */
    public getTickSystems(): readonly TickSystem[] {
        return this.tickSystems;
    }

    /** Register an additional building creation handler. */
    onBuildingCreated(handler: BuildingCreatedHandler): void {
        this.extraCreatedHandlers.push(handler);
    }

    /** Register an additional entity removal handler. */
    onEntityRemoved(handler: EntityRemovedHandler): void {
        this.extraRemovedHandlers.push(handler);
    }

    /** Clean up all event subscriptions and system state */
    public destroy(): void {
        for (const system of this.tickSystems) {
            if (system.destroy) {
                system.destroy();
            }
        }
        this.featureRegistry.destroy();
        this.subscriptions.unsubscribeAll();
        this.extraCreatedHandlers.length = 0;
        this.extraRemovedHandlers.length = 0;
    }

    private addSystem(system: TickSystem): void {
        this.tickSystems.push(system);
    }

    // ── Building lifecycle handling ─────────────────────────────────────

    private handleBuildingCreated(
        entityId: number,
        buildingType: BuildingType,
        x: number,
        y: number,
        player: number
    ): void {
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

    private handleEntityRemoved(entityId: number): void {
        // Clean up carrier state if this was a carrier
        if (this.carrierManager.hasCarrier(entityId)) {
            this.carrierManager.removeCarrier(entityId);
        }

        // Clean up building construction state
        this.buildingStateManager.removeBuildingState(entityId);

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

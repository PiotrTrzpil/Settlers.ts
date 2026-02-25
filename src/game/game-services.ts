/**
 * GameServices — composition root for all game managers and systems.
 *
 * Creates, wires, and owns every domain manager and tick system.
 * Each feature/manager self-subscribes to lifecycle events via registerEvents()
 * or FeatureRegistry. This module contains no domain logic — only construction,
 * wiring, and the entity:removed handler ordering constraint.
 *
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
    InventoryFeature,
    type InventoryExports,
} from './features/inventory';
import {
    LogisticsDispatcher,
    RequestManager,
    RequestManagerFeature,
    type RequestManagerExports,
} from './features/logistics';
import { ServiceAreaManager, ServiceAreaFeature, type ServiceAreaExports } from './features/service-areas';
import { FeatureRegistry } from './features/feature-registry';
import { TreeFeature, TreeSystem, type TreeFeatureExports } from './features/trees';
import { StoneFeature, StoneSystem, type StoneFeatureExports } from './features/stones';
import { EventBus, EventSubscriptionManager } from './event-bus';
import { EntityType, UnitType, getUnitTypeSpeed } from './entity';
import { AnimationService } from './animation/index';
import type { Command, CommandResult } from './commands';

export class GameServices {
    // ===== Animation =====
    /** Animation service — manages entity animations */
    public readonly animationService: AnimationService;

    // ===== Managers (own state, no tick) =====
    /** Carrier manager — tracks carrier state and assignments */
    public readonly carrierManager: CarrierManager;

    /** Building inventory manager — tracks building input/output slots (via FeatureRegistry) */
    public readonly inventoryManager!: BuildingInventoryManager;

    /** Service area manager — tracks logistics service areas (via FeatureRegistry) */
    public readonly serviceAreaManager!: ServiceAreaManager;

    /** Request manager — tracks material delivery requests (via FeatureRegistry) */
    public readonly requestManager!: RequestManager;

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

    /** Stone mining system — depletion and variant tracking */
    public readonly stoneSystem: StoneSystem;

    // ===== Internal =====
    private readonly featureRegistry: FeatureRegistry;
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly eventBus: EventBus;
    private readonly tickSystems: TickSystem[] = [];

    constructor(gameState: GameState, eventBus: EventBus, executeCommand: (cmd: Command) => CommandResult) {
        this.eventBus = eventBus;

        // 1. Animation service — other systems depend on it
        this.animationService = new AnimationService();

        // 2. Manually-created managers (complex wiring that isn't yet feature-based)
        this.carrierManager = new CarrierManager({
            entityProvider: gameState,
            eventBus,
        });
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
        gameState.initMovement(this.movement);
        this.addSystem(this.movement);

        // 4. Building construction system
        this.constructionSystem = new BuildingConstructionSystem({
            gameState,
            buildingStateManager: this.buildingStateManager,
            executeCommand,
        });
        this.constructionSystem.registerEvents(eventBus);
        this.addSystem(this.constructionSystem);

        // 5. Register early lifecycle events — building state and carriers self-subscribe.
        //    Must happen before feature loading so handlers fire in the right order.
        this.buildingStateManager.registerEvents(eventBus);
        this.carrierManager.registerEvents(eventBus);
        this.addSystem(this.carrierManager);

        // 6. Feature registry — load self-registering features.
        //    Features subscribe to entity:created/entity:removed for their own state.
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            animationService: this.animationService,
        });

        // Bridge manually-created managers so registry features can access them
        this.featureRegistry.registerExports('building-construction', {
            buildingStateManager: this.buildingStateManager,
        });

        this.featureRegistry.loadAll([
            ServiceAreaFeature,
            InventoryFeature,
            RequestManagerFeature,
            TreeFeature,
            StoneFeature,
            MaterialRequestFeature,
        ]);

        // Retrieve managers created by features
        this.serviceAreaManager =
            this.featureRegistry.getFeatureExports<ServiceAreaExports>('service-areas').serviceAreaManager;
        this.inventoryManager = this.featureRegistry.getFeatureExports<InventoryExports>('inventory').inventoryManager;
        this.requestManager = this.featureRegistry.getFeatureExports<RequestManagerExports>('logistics').requestManager;

        // Wire carrier manager to service areas (now available after feature loading)
        this.carrierManager.setServiceAreaManager(this.serviceAreaManager);

        this.treeSystem = this.featureRegistry.getFeatureExports<TreeFeatureExports>('trees').treeSystem;
        this.treeSystem.setCommandExecutor(executeCommand);
        this.stoneSystem = this.featureRegistry.getFeatureExports<StoneFeatureExports>('stones').stoneSystem;
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

        // 8. Logistics dispatcher — registers for carrier events AND entity:removed.
        //    MUST be registered before inventory removal (logistics needs inventory for reservation release).
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
        this.settlerTaskSystem.registerWorkHandler(
            SearchType.STONE,
            createStonecuttingHandler(gameState, this.stoneSystem)
        );
        this.settlerTaskSystem.registerWorkHandler(SearchType.TREE_SEED_POS, createForesterHandler(this.treeSystem));

        // 10. Inventory visualizer — subscribes to entity:removed for visual cleanup
        this.inventoryVisualizer = new InventoryVisualizer(gameState, this.inventoryManager, executeCommand);
        this.inventoryVisualizer.registerEvents(eventBus);

        // 11. Core entity lifecycle — movement controllers and resource state.
        //     These are not feature-specific, so they stay in the composition root.
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, type, subType, x, y }) => {
            if (type === EntityType.Unit) {
                const speed = getUnitTypeSpeed(subType as UnitType);
                this.movement.createController(entityId, x, y, speed);
            } else if (type === EntityType.StackedResource) {
                gameState.resources.createState(entityId);
            }
        });
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            this.movement.removeController(entityId);
            gameState.resources.removeState(entityId);
        });

        // 12. Late inventory removal — MUST happen after logistics cleanup (step 8).
        //     Logistics releases inventory reservations during entity:removed, so
        //     inventory data must still exist when that handler fires.
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            this.inventoryManager.removeInventory(entityId);
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

    /** Clean up all event subscriptions and system state */
    public destroy(): void {
        for (const system of this.tickSystems) {
            if (system.destroy) {
                system.destroy();
            }
        }
        this.featureRegistry.destroy();
        this.buildingStateManager.unregisterEvents();
        this.carrierManager.unregisterEvents();
        this.inventoryVisualizer.unregisterEvents();
        this.subscriptions.unsubscribeAll();
    }

    private addSystem(system: TickSystem): void {
        this.tickSystems.push(system);
    }
}

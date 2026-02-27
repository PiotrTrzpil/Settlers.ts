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
    createCropHarvestHandler,
    createPlantingHandler,
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
import { CropFeature, CropSystem, type CropFeatureExports } from './features/crops';
import { CombatFeature, CombatSystem, type CombatExports } from './features/combat';
import { TerritoryManager, registerTerritoryEvents } from './features/territory';
import { WorkAreaStore } from './features/work-areas';
import { BuildingOverlayManager, OverlayRegistry, populateOverlayRegistry } from './systems/building-overlays';
import { EntityCleanupRegistry, CLEANUP_PRIORITY } from './systems/entity-cleanup-registry';
import { EventBus, EventSubscriptionManager } from './event-bus';
import { EntityType, UnitType, getUnitTypeSpeed } from './entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { EntityVisualService } from './animation/entity-visual-service';
import type { Command, CommandResult } from './commands';

export class GameServices {
    // ===== Animation =====
    /** Visual service — manages entity visual state (variation + animation) */
    public readonly visualService: EntityVisualService;

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

    /** Building overlay manager — tracks layered sprite overlays on buildings */
    public readonly buildingOverlayManager: BuildingOverlayManager;

    /** Overlay registry — static definitions for building overlays (shared with renderer) */
    public readonly overlayRegistry: OverlayRegistry;

    /** Territory manager — tracks territory zones from towers/castles (set in setTerrainData) */
    public territoryManager!: TerritoryManager;

    /** Work area store — per-building work area offsets (shared between UI and gameplay) */
    public readonly workAreaStore: WorkAreaStore;

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

    /** Crop lifecycle system — growth, harvesting, and decay */
    public readonly cropSystem: CropSystem;

    /** Combat system — enemy detection, pursuit, and melee damage */
    public readonly combatSystem: CombatSystem;

    // ===== Internal =====
    private readonly featureRegistry: FeatureRegistry;
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly cleanupRegistry = new EntityCleanupRegistry();
    private readonly eventBus: EventBus;
    private readonly tickSystems: { system: TickSystem; group: string }[] = [];
    private territoryCleanup: (() => void) | null = null;

    constructor(gameState: GameState, eventBus: EventBus, executeCommand: (cmd: Command) => CommandResult) {
        this.eventBus = eventBus;

        // 1. Visual service — other systems depend on it.
        //    Init handler MUST fire before any feature handler (order matters).
        this.visualService = new EntityVisualService();
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, variation }) => {
            this.visualService.init(entityId, variation);
        });

        // 2. Manually-created managers (complex wiring that isn't yet feature-based)
        this.carrierManager = new CarrierManager({
            entityProvider: gameState,
            eventBus,
        });
        this.buildingStateManager = new BuildingStateManager({
            entityProvider: gameState,
            eventBus,
        });

        // 2b. Building overlay system — layered sprites on buildings
        this.overlayRegistry = new OverlayRegistry();
        populateOverlayRegistry(this.overlayRegistry);
        this.buildingOverlayManager = new BuildingOverlayManager({
            overlayRegistry: this.overlayRegistry,
            entityProvider: gameState,
        });

        // 2c. Work area store — per-building work area offsets
        this.workAreaStore = new WorkAreaStore();

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
        this.addSystem(this.movement, 'Units');

        // 4. Building construction system
        this.constructionSystem = new BuildingConstructionSystem({
            gameState,
            buildingStateManager: this.buildingStateManager,
            executeCommand,
        });
        this.constructionSystem.registerEvents(eventBus);
        this.addSystem(this.constructionSystem, 'Buildings');

        // 5. Register early lifecycle events — building state and carriers self-subscribe.
        //    Must happen before feature loading so handlers fire in the right order.
        this.buildingStateManager.registerEvents(eventBus, this.cleanupRegistry);
        this.buildingOverlayManager.registerEvents(eventBus, this.cleanupRegistry);
        this.carrierManager.registerEvents(eventBus, this.cleanupRegistry);
        this.addSystem(this.buildingOverlayManager, 'Buildings');
        this.addSystem(this.carrierManager, 'Logistics');

        // 6. Feature registry — load self-registering features.
        //    Features register with cleanupRegistry for entity:removed cleanup.
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            visualService: this.visualService,
            cleanupRegistry: this.cleanupRegistry,
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
            CropFeature,
            MaterialRequestFeature,
            CombatFeature,
        ]);

        // Retrieve managers created by features
        this.serviceAreaManager =
            this.featureRegistry.getFeatureExports<ServiceAreaExports>('service-areas').serviceAreaManager;
        this.inventoryManager = this.featureRegistry.getFeatureExports<InventoryExports>('inventory').inventoryManager;
        this.requestManager = this.featureRegistry.getFeatureExports<RequestManagerExports>('logistics').requestManager;

        // Wire carrier manager to service areas (now available after feature loading)
        this.carrierManager.setServiceAreaManager(this.serviceAreaManager);

        this.combatSystem = this.featureRegistry.getFeatureExports<CombatExports>('combat').combatSystem;
        this.treeSystem = this.featureRegistry.getFeatureExports<TreeFeatureExports>('trees').treeSystem;
        this.treeSystem.setCommandExecutor(executeCommand);
        this.stoneSystem = this.featureRegistry.getFeatureExports<StoneFeatureExports>('stones').stoneSystem;
        this.cropSystem = this.featureRegistry.getFeatureExports<CropFeatureExports>('crops').cropSystem;
        this.cropSystem.setCommandExecutor(executeCommand);
        const featureSystemGroups: Record<string, string> = {
            TreeSystem: 'World',
            CropSystem: 'World',
            MaterialRequestSystem: 'Logistics',
            CombatSystem: 'Units',
        };
        for (const system of this.featureRegistry.getSystems()) {
            this.addSystem(system, featureSystemGroups[system.constructor.name] ?? 'Other');
        }

        // 7. Settler task system
        this.settlerTaskSystem = new SettlerTaskSystem({
            gameState,
            visualService: this.visualService,
            inventoryManager: this.inventoryManager,
            carrierManager: this.carrierManager,
            eventBus,
            getInventoryVisualizer: () => this.inventoryVisualizer,
        });
        this.addSystem(this.settlerTaskSystem, 'Units');

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
        this.logisticsDispatcher.registerEvents(eventBus, this.cleanupRegistry);
        this.addSystem(this.logisticsDispatcher, 'Logistics');

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

        // Crop handlers — each crop type gets entity (harvest) + position (plant) handlers
        const cropHandlerConfigs: Array<{ search: SearchType; crop: MapObjectType }> = [
            { search: SearchType.GRAIN, crop: MapObjectType.Grain },
            { search: SearchType.SUNFLOWER, crop: MapObjectType.Sunflower },
            { search: SearchType.AGAVE, crop: MapObjectType.Agave },
            { search: SearchType.BEEHIVE, crop: MapObjectType.Beehive },
        ];
        for (const { search, crop } of cropHandlerConfigs) {
            this.settlerTaskSystem.registerWorkHandler(
                search,
                createCropHarvestHandler(gameState, this.cropSystem, crop)
            );
            this.settlerTaskSystem.registerWorkHandler(
                search,
                createPlantingHandler(this.cropSystem.getCropPlanter(crop))
            );
        }

        // 10. Inventory visualizer — registers for entity:removed cleanup
        this.inventoryVisualizer = new InventoryVisualizer(gameState, this.inventoryManager, executeCommand);
        this.inventoryVisualizer.registerEvents(eventBus, this.cleanupRegistry);

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
        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.movement.removeController(entityId);
            this.visualService.remove(entityId);
            gameState.resources.removeState(entityId);
            this.workAreaStore.removeInstance(entityId);
        });

        // 12. Late inventory removal — MUST happen after logistics cleanup (step 8).
        //     Uses CLEANUP_PRIORITY.LATE to ensure inventory data still exists when
        //     LogisticsDispatcher releases inventory reservations (LOGISTICS priority).
        this.cleanupRegistry.onEntityRemoved(
            entityId => this.inventoryManager.removeInventory(entityId),
            CLEANUP_PRIORITY.LATE
        );

        // Wire the registry to the event bus — single subscription drives all cleanup handlers.
        this.cleanupRegistry.registerEvents(eventBus);
    }

    /** Provide terrain data to movement and construction systems */
    public setTerrainData(terrain: TerrainData): void {
        this.movement.setTerrainData(terrain.groundType, terrain.groundHeight, terrain.width, terrain.height);
        this.constructionSystem.setTerrainContext({
            terrain,
            onTerrainModified: () => this.eventBus.emit('terrain:modified', {}),
        });

        // Territory manager needs map dimensions from terrain.
        // Created here (before populateMapEntities) so events are registered
        // before buildings are loaded.
        this.territoryManager = new TerritoryManager(terrain.width, terrain.height);
        const territorySubscriptions = registerTerritoryEvents(
            this.eventBus,
            this.territoryManager,
            this.cleanupRegistry
        );
        this.territoryCleanup = () => territorySubscriptions.unsubscribeAll();

        // Wire territory manager to logistics dispatcher for territory-based carrier filtering
        this.logisticsDispatcher.setTerritoryManager(this.territoryManager);
    }

    /** Ordered tick systems for the frame loop, with group labels */
    public getTickSystems(): readonly { system: TickSystem; group: string }[] {
        return this.tickSystems;
    }

    /** Clean up all event subscriptions and system state */
    public destroy(): void {
        for (const { system } of this.tickSystems) {
            if (system.destroy) {
                system.destroy();
            }
        }
        this.featureRegistry.destroy();
        this.buildingStateManager.unregisterEvents();
        this.buildingOverlayManager.unregisterEvents();
        this.carrierManager.unregisterEvents();
        this.inventoryVisualizer.unregisterEvents();
        this.territoryCleanup?.();
        this.cleanupRegistry.destroy();
        this.subscriptions.unsubscribeAll();
    }

    private addSystem(system: TickSystem, group = 'Other'): void {
        this.tickSystems.push({ system, group });
    }
}

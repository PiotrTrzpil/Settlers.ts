/**
 * GameServices — composition root for all game managers and systems.
 *
 * Creates a FeatureRegistry, loads all game features in dependency order,
 * and exposes commonly-accessed managers/systems as typed properties.
 *
 * All domain logic lives in feature modules (src/game/features/).
 * This module contains no domain logic — only feature loading,
 * property extraction, and the entity:removed ordering constraint.
 */

import { GameState } from './game-state';
import type { TerrainData } from './terrain';
import type { TickSystem } from './core/tick-system';
import { EntityType, UnitType, getUnitTypeSpeed } from './entity';
import { isAngelUnitType } from './core/unit-types';
import { EventBus, EventSubscriptionManager } from './event-bus';
import { EntityVisualService } from './animation/entity-visual-service';
import type { CommandType, ExecuteCommand } from './commands';
import { EntityCleanupRegistry, CLEANUP_PRIORITY } from './systems/entity-cleanup-registry';
import { UnitReservationRegistry } from './systems/unit-reservation';
import { FeatureRegistry } from './features/feature-registry';
import type { BoundCommandHandler } from './features/feature';
import type { RenderPassDefinition } from './renderer/render-passes/types';
import { RenderDataRegistry } from './features/render-data-registry';
import { DiagnosticsRegistry } from './features/diagnostics-registry';
import { PersistenceRegistry, type Persistable } from './persistence';

import { MovementSystem } from './systems/movement';
import { TickScheduler } from './systems/tick-scheduler';

// Feature definitions
import { WorkAreaFeature, type WorkAreaExports } from './features/work-areas/work-areas-feature';
import {
    ProductionControlFeature,
    type ProductionControlExports,
} from './features/production-control/production-control-feature';
import { CarrierFeature, type CarrierFeatureExports } from './features/carriers';
import { DemandQueueFeature, type DemandQueueExports } from './features/logistics';
import { BuildingOverlayFeature, type BuildingOverlayFeatureExports } from './features/building-overlays';
import {
    BuildingConstructionFeature,
    type BuildingConstructionExports,
} from './features/building-construction/building-construction-feature';
import { MaterialRequestFeature } from './features/material-requests';
import { TreeFeature, type TreeFeatureExports } from './features/trees';
import { StoneFeature, type StoneFeatureExports } from './features/stones';
import { CropFeature } from './features/crops';
import { CombatFeature, type CombatExports } from './features/combat';
import { OreSignFeature, type OreSignExports } from './features/ore-veins';
import { MaterialTransferFeature } from './features/material-transfer/material-transfer-feature';
import { SettlerTaskFeature, type SettlerTaskExports } from './features/settler-tasks/settler-tasks-feature';
import { RecruitFeature, type RecruitExports } from './features/recruit';
import { BuildingDemandFeature } from './features/building-demand/building-demand-feature';
import { ConstructionDemandFeature } from './features/building-construction/construction-demand-feature';
import { ChoreoBuilder } from './systems/choreo/choreo-builder';
import type { UnitTransformer } from './features/recruit';
import type { RecruitSystem } from './systems/recruit';

import {
    LogisticsDispatcherFeature,
    type LogisticsDispatcherExports,
} from './features/logistics/logistics-dispatcher-feature';
import { BarracksFeature, type BarracksExports } from './features/barracks/barracks-feature';
import { TowerGarrisonFeature, type TowerGarrisonExports } from './features/tower-garrison';
import { SettlerLocationFeature } from './features/settler-location';
import type { SettlerLocationExports } from './features/settler-location/types';
import { FreePilesFeature } from './features/inventory/free-piles-feature';
import { TerritoryFeature, type TerritoryExports } from './features/territory/territory-feature';
import { VictoryConditionsFeature, type VictoryConditionsExports } from './features/victory-conditions';
import { BuildingSiegeFeature, type BuildingSiegeExports } from './features/building-siege';
import type { BuildingSiegeSystem } from './features/building-siege/building-siege-system';
import { AiPlayerFeature, type AiPlayerExports } from './features/ai-player';

// Re-export types that external code imports transitively via GameServices
import type { CarrierRegistry } from './features/carriers';
import { BuildingInventoryManager, StorageFilterManager } from './systems/inventory';
import type { BuildingPileRegistry } from './systems/inventory/building-pile-registry';
import type { DemandQueue, TransportJobStore, LogisticsDispatcher } from './features/logistics';
import type { BuildingOverlayManager, OverlayRegistry } from './features/building-overlays';
import type {
    ConstructionSiteManager,
    BuildingConstructionSystem,
    ResidenceSpawnerSystem,
} from './features/building-construction';
import type { TerritoryManager } from './features/territory';
import type { WorkAreaStore } from './features/work-areas';
import type { ProductionControlManager } from './features/production-control';
import type { BarracksTrainingManager } from './features/barracks';
import type { TowerGarrisonManager } from './features/tower-garrison';
import type { TreeSystem } from './features/trees';
import type { StoneSystem } from './features/stones';
import type { CombatSystem } from './features/combat';
import type { OreVeinData, ResourceSignSystem } from './features/ore-veins';
import type { SettlerTaskSystem } from './features/settler-tasks';
import type { ISettlerBuildingLocationManager } from './features/settler-location/types';
import type { VictoryConditionsSystem } from './features/victory-conditions';
import type { AiPlayerSystem } from './features/ai-player/types';

export class GameServices {
    // ===== Kernel services =====
    public readonly tickScheduler: TickScheduler;
    public readonly visualService: EntityVisualService;

    // ===== Managers & systems (extracted from feature exports) =====
    public readonly movement: MovementSystem;
    public readonly carrierRegistry: CarrierRegistry;
    public readonly inventoryManager: BuildingInventoryManager;
    public readonly storageFilterManager: StorageFilterManager;
    public readonly demandQueue: DemandQueue;
    public readonly jobStore: TransportJobStore;
    public readonly buildingOverlayManager: BuildingOverlayManager;
    public readonly overlayRegistry: OverlayRegistry;
    public readonly constructionSiteManager: ConstructionSiteManager;
    public readonly constructionSystem: BuildingConstructionSystem;
    public readonly residenceSpawner: ResidenceSpawnerSystem;
    public readonly workAreaStore: WorkAreaStore;
    public readonly productionControlManager: ProductionControlManager;
    public readonly settlerTaskSystem: SettlerTaskSystem;
    public readonly logisticsDispatcher: LogisticsDispatcher;
    public readonly barracksTrainingManager: BarracksTrainingManager;
    public readonly garrisonManager: TowerGarrisonManager;
    public readonly treeSystem: TreeSystem;
    public readonly stoneSystem: StoneSystem;
    public readonly combatSystem: CombatSystem;
    public readonly siegeSystem: BuildingSiegeSystem;
    public readonly signSystem: ResourceSignSystem;
    public readonly locationManager: ISettlerBuildingLocationManager;

    public readonly victorySystem: VictoryConditionsSystem;
    public readonly unitTransformer: UnitTransformer;
    public readonly recruitSystem: RecruitSystem;
    public readonly pileRegistry: BuildingPileRegistry | null;
    public readonly aiSystem: AiPlayerSystem;
    public readonly persistenceRegistry: PersistenceRegistry;

    /** Territory manager — available after setTerrainData(). */
    public get territoryManager(): TerritoryManager {
        return this.featureRegistry.getFeatureExports<TerritoryExports>('territory').territoryManager!;
    }

    /** Ore vein data — available after setTerrainData(). */
    public get oreVeinData(): OreVeinData {
        return this.featureRegistry.getFeatureExports<OreSignExports>('ore-signs').oreVeinData!;
    }

    // ===== Internal =====
    private readonly featureRegistry: FeatureRegistry;
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly cleanupRegistry = new EntityCleanupRegistry();

    // ===== Shared kernel services (also exposed for command registration) =====
    public readonly unitReservation: UnitReservationRegistry;

    private readonly gameState: GameState;

    constructor(gameState: GameState, eventBus: EventBus, executeCommand: ExecuteCommand) {
        this.gameState = gameState;
        // 1. Kernel services — created before features, provided via FeatureContext.
        //    UnitReservationRegistry must subscribe to entity:removed BEFORE cleanupRegistry
        //    so onForcedRelease fires before any feature-level cleanup handlers.
        this.unitReservation = new UnitReservationRegistry(eventBus);
        this.visualService = new EntityVisualService();
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, variation }) =>
            this.visualService.init(entityId, variation)
        );
        // When any unit changes type (carrier↔specialist), clear the stale animation
        // so the idle/task controller re-derives the correct sequence key on the next tick.
        const clearAnim = ({ unitId }: { unitId: number }) => this.visualService.clearAnimation(unitId);
        this.subscriptions.subscribe(eventBus, 'unit:recruited', clearAnim);
        this.subscriptions.subscribe(eventBus, 'unit:dismissed', clearAnim);

        // 1a. Tick scheduler — no dependencies, must tick before movement.
        this.tickScheduler = new TickScheduler();

        // 2. Inventory system — instantiated directly (not a feature).
        this.inventoryManager = new BuildingInventoryManager();
        this.storageFilterManager = new StorageFilterManager();

        // inventory:changed events are now emitted directly by BuildingInventoryManager via EventBus.

        // 3. Feature registry — loads all game features in dependency order.
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            visualService: this.visualService,
            cleanupRegistry: this.cleanupRegistry,
            unitReservation: this.unitReservation,
            executeCommand,
            tickScheduler: this.tickScheduler,
        });

        // Register inventory exports so features can access via ctx.getFeature('inventory')
        this.featureRegistry.registerExports(
            'inventory',
            {
                inventoryManager: this.inventoryManager,
                storageFilterManager: this.storageFilterManager,
            },
            [
                { persistable: this.inventoryManager.slotStore, after: ['constructionSites'] },
                this.inventoryManager.nextSlotIdStore,
                this.inventoryManager.throughputStore,
                this.storageFilterManager.persistentStore,
            ]
        );

        // 3a. Movement system — instantiated directly (not a feature).
        this.movement = new MovementSystem({
            eventBus,
            updatePosition: (id, x, y) => {
                gameState.updateEntityPosition(id, x, y);
                return true;
            },
            getEntity: gameState.getEntity.bind(gameState),
            unitOccupancy: gameState.unitOccupancy,
            buildingOccupancy: gameState.buildingOccupancy,
            buildingFootprint: gameState.buildingFootprint,
        });
        gameState.initMovement(this.movement);

        // Create movement controllers for units on spawn (skip ephemeral angels)
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, entityType: type, subType, x, y }) => {
            if (type === EntityType.Unit && !isAngelUnitType(subType as UnitType)) {
                const speed = getUnitTypeSpeed(subType as UnitType);
                this.movement.createController(entityId, x, y, speed);
            }
        });

        // Remove movement controllers on entity removal
        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.movement.removeController(entityId);
        });

        // Register tick scheduler before movement so deferred callbacks fire first
        this.featureRegistry.registerSystem(this.tickScheduler, 'Core');

        // Register movement as a tick system
        this.featureRegistry.registerSystem(this.movement, 'Units');

        this.featureRegistry.loadAll([
            // Tier 0: no dependencies
            WorkAreaFeature,
            ProductionControlFeature,
            CarrierFeature,
            DemandQueueFeature,
            BuildingOverlayFeature,
            TreeFeature,
            StoneFeature,
            CropFeature,
            CombatFeature,
            OreSignFeature,
            TerritoryFeature,
            SettlerLocationFeature,
            // Tier 1: depend on tier-0 features
            BuildingConstructionFeature,
            MaterialTransferFeature,
            MaterialRequestFeature,
            // Tier 2: depend on tier-0 and tier-1
            SettlerTaskFeature,
            // Tier 3: depend on settler-tasks
            LogisticsDispatcherFeature,
            // Tier 4: depend on logistics-dispatcher
            BarracksFeature,
            TowerGarrisonFeature,
            BuildingSiegeFeature,
            RecruitFeature,
            BuildingDemandFeature,
            ConstructionDemandFeature,
            // Independent chains
            VictoryConditionsFeature,
            // AI — depends on combat, territory, victory-conditions, inventory
            AiPlayerFeature,
            FreePilesFeature,
        ]);

        // 4. Extract commonly-accessed exports for external consumers.
        this.carrierRegistry = this.feat<CarrierFeatureExports>('carriers').carrierRegistry;
        this.demandQueue = this.feat<DemandQueueExports>('logistics').demandQueue;
        this.jobStore = this.feat<DemandQueueExports>('logistics').jobStore;
        const overlayExports = this.feat<BuildingOverlayFeatureExports>('building-overlays');
        this.buildingOverlayManager = overlayExports.buildingOverlayManager;
        this.overlayRegistry = overlayExports.overlayRegistry;
        const constrExports = this.feat<BuildingConstructionExports>('building-construction');
        this.constructionSiteManager = constrExports.constructionSiteManager;
        this.constructionSystem = constrExports.constructionSystem;
        this.residenceSpawner = constrExports.residenceSpawner;
        this.workAreaStore = this.feat<WorkAreaExports>('work-areas').workAreaStore;
        this.productionControlManager =
            this.feat<ProductionControlExports>('production-control').productionControlManager;
        this.settlerTaskSystem = this.feat<SettlerTaskExports>('settler-tasks').settlerTaskSystem;
        this.logisticsDispatcher = this.feat<LogisticsDispatcherExports>('logistics-dispatcher').logisticsDispatcher;
        this.barracksTrainingManager = this.feat<BarracksExports>('barracks').barracksTrainingManager;
        this.garrisonManager = this.feat<TowerGarrisonExports>('tower-garrison').garrisonManager;
        this.treeSystem = this.feat<TreeFeatureExports>('trees').treeSystem;
        this.stoneSystem = this.feat<StoneFeatureExports>('stones').stoneSystem;
        this.combatSystem = this.feat<CombatExports>('combat').combatSystem;
        this.siegeSystem = this.feat<BuildingSiegeExports>('building-siege').siegeSystem;
        this.signSystem = this.feat<OreSignExports>('ore-signs').signSystem;
        this.locationManager = this.feat<SettlerLocationExports>('settler-location').locationManager;
        this.victorySystem = this.feat<VictoryConditionsExports>('victory-conditions').victorySystem;
        const arExports = this.feat<RecruitExports>('recruit');

        this.unitTransformer = arExports.unitTransformer;
        this.aiSystem = this.feat<AiPlayerExports>('ai-player').aiSystem;
        this.recruitSystem = arExports.recruitSystem;
        this.pileRegistry = constrExports.pileRegistry;

        // 5. Persistence registry — register feature-declared persistables first, then manual ones.
        this.persistenceRegistry = new PersistenceRegistry();
        for (const { persistable, after } of this.featureRegistry.getPersistables()) {
            this.persistenceRegistry.register(persistable, after);
        }
        // Pile state derived from inventory slots — no separate persistence needed.

        // 6. Wire pile registry to settler-tasks (cross-feature, conditional).
        if (constrExports.pileRegistry) {
            this.feat<SettlerTaskExports>('settler-tasks').setPileRegistry(constrExports.pileRegistry);
        }

        // 7. Core entity lifecycle — too small to be a feature.
        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.visualService.remove(entityId);
            this.inventoryManager.onPileEntityRemoved(entityId);
        });

        // 8. Late inventory removal — MUST happen after logistics cleanup.
        this.cleanupRegistry.onEntityRemoved(
            this.inventoryManager.destroySlots.bind(this.inventoryManager),
            CLEANUP_PRIORITY.LATE
        );

        // Wire the registry to the event bus — single subscription drives all cleanup handlers.
        this.cleanupRegistry.registerEvents(eventBus);
    }

    /** Provide terrain data to all features that need it. */
    public setTerrainData(terrain: TerrainData, resourceData?: Uint8Array): void {
        ChoreoBuilder.withContext({ gameState: this.gameState, terrain });
        this.movement.setTerrainData(terrain.groundType, terrain.groundHeight, terrain.width, terrain.height);
        this.featureRegistry.setTerrainData(terrain, resourceData);
    }

    /** Ordered tick systems for the frame loop, with group labels. */
    public getTickSystems(): readonly { system: TickSystem; group: string }[] {
        return this.featureRegistry.getSystems();
    }

    /** Feature-collected persistables (from features using self-registration). */
    public getFeaturePersistables(): readonly { persistable: Persistable; after: string[] }[] {
        return this.featureRegistry.getPersistables();
    }

    /** Feature-collected command handlers. */
    public getFeatureCommandHandlers(): ReadonlyMap<CommandType, BoundCommandHandler> {
        return this.featureRegistry.getCommandHandlers();
    }

    /** Feature-provided render pass definitions. */
    public getFeatureRenderPassDefinitions(): readonly RenderPassDefinition[] {
        return this.featureRegistry.getRenderPassDefinitions();
    }

    /** Render data registry for glue layer. */
    public getRenderDataRegistry(): RenderDataRegistry {
        return this.featureRegistry.getRenderDataRegistry();
    }

    /** Diagnostics registry for debug panel. */
    public getDiagnosticsRegistry(): DiagnosticsRegistry {
        return this.featureRegistry.getDiagnosticsRegistry();
    }

    /** Notify all features that snapshot restoration is complete (dependency order). */
    public notifyRestoreComplete(): void {
        this.featureRegistry.notifyRestoreComplete();
    }

    /** Clean up all event subscriptions and system state. */
    public destroy(): void {
        this.featureRegistry.destroy();
        this.cleanupRegistry.destroy();
        this.subscriptions.unsubscribeAll();
    }

    private feat<T>(featureId: string): T {
        return this.featureRegistry.getFeatureExports<T>(featureId);
    }
}

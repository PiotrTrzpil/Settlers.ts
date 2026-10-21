/**
 * GameServices — composition root for all game managers and systems.
 *
 * Creates a FeatureRegistry, loads all game features in dependency order,
 * and exposes the widely-shared managers/systems (UI, renderer, debug, tests)
 * as typed properties. Anything else is reached via `getFeature<Exports>(id)`,
 * so adding a feature does not require new fields here.
 *
 * All domain logic lives in feature modules (src/game/features/).
 * This module contains no domain logic — only feature loading,
 * property extraction, and the entity:removed ordering constraint.
 */

import { GameState } from './game-state';
import type { TerrainData } from './terrain';
import { TickPhase, type PhasedTickSystem } from './core/tick-phase';
import { EntityType, UnitType, getUnitTypeSpeed } from './entity';
import { MapObjectBlockingTracker } from './map-object-blocking';
import { isAngelUnitType } from './core/unit-types';
import { EventBus, EventSubscriptionManager } from './event-bus';
import { EntityVisualService } from './animation/entity-visual-service';
import type { CommandType, ExecuteCommand } from './commands';
import { EntityCleanupRegistry } from './systems/entity-cleanup-registry';
import { UnitReservationRegistry } from './systems/unit-reservation';
import { FeatureRegistry } from './features/feature-registry';
import type { BoundCommandHandler } from './features/feature';
import type { RenderPassDefinition } from './renderer/render-passes/types';
import { RenderDataRegistry } from './features/render-data-registry';
import { DiagnosticsRegistry } from './features/diagnostics-registry';
import { PersistenceRegistry, type Persistable } from './persistence';

import type { MovementSystem } from './systems/movement';
import { TickScheduler } from './systems/tick-scheduler';
import { ChoreoSystem } from './systems/choreo';

// Feature definitions
import { WorkAreaFeature, type WorkAreaExports } from './features/work-areas/work-areas-feature';
import { ProductionControlFeature } from './features/production-control';
import { CarrierFeature, type CarrierFeatureExports } from './features/carriers';
import { DemandLedgerFeature, type DemandLedgerExports } from './features/logistics';
import { BuildingOverlayFeature, type BuildingOverlayFeatureExports } from './features/building-overlays';
import {
    BuildingConstructionFeature,
    BuildingPlacementFeature,
    type BuildingConstructionExports,
} from './features/building-construction';
import { MaterialRequestFeature } from './features/material-requests';
import { TreeFeature, type TreeFeatureExports } from './features/trees';
import { StoneFeature, type StoneFeatureExports } from './features/stones';
import { CropFeature } from './features/crops';
import { CombatFeature, type CombatExports } from './features/combat';
import { OreSignFeature, OreVeinFeature } from './features/ore-veins';
import { MaterialTransferFeature } from './features/material-transfer/material-transfer-feature';
import { SettlerTaskFeature, type SettlerTaskExports } from './features/settler-tasks';
import { RecruitFeature, type RecruitExports } from './features/recruit';
import { BuildingDemandFeature } from './features/building-demand/building-demand-feature';
import type { UnitTransformer, RecruitSystem } from './features/recruit';

import {
    LogisticsDispatcherFeature,
    type LogisticsDispatcherExports,
} from './features/logistics/logistics-dispatcher-feature';
import { BarracksFeature } from './features/barracks/barracks-feature';
import { TowerGarrisonFeature, type TowerGarrisonExports } from './features/tower-garrison';
import { SettlerLocationFeature } from './features/settler-location';
import { InventoryFeature, FreePilesFeature, type InventoryExports } from './features/inventory';
import { TerritoryFeature, TerritoryConsequencesFeature, type TerritoryExports } from './features/territory';
import { VictoryConditionsFeature, type VictoryConditionsExports } from './features/victory-conditions';
import { BuildingSiegeFeature, type BuildingSiegeExports } from './features/building-siege';
import type { BuildingSiegeSystem } from './features/building-siege/building-siege-system';
import type { GameplaySettings } from './game-settings';
import { AiPlayerFeature } from './features/ai-player';
import { PioneerFeature } from './features/pioneer';

// Re-export types that external code imports transitively via GameServices
import type { CarrierRegistry } from './features/carriers';
import type { BuildingInventoryManager, StorageFilterManager } from './features/inventory';
import type { DemandLedger, TransportJobStore, LogisticsDispatcher } from './features/logistics';
import type { BuildingOverlayManager, OverlayRegistry } from './features/building-overlays';
import type { ConstructionSiteManager } from './features/building-construction';
import type { TerritoryManager } from './features/territory';
import type { WorkAreaStore } from './features/work-areas';
import type { TowerGarrisonManager } from './features/tower-garrison';
import type { TreeSystem } from './features/trees';
import type { StoneSystem } from './features/stones';
import type { CombatSystem } from './features/combat';
import type { SettlerTaskSystem, JobRunner, WorkerAssignments } from './features/settler-tasks';
import type { VictoryConditionsSystem } from './features/victory-conditions';

export class GameServices {
    // ===== Kernel services =====
    public readonly tickScheduler: TickScheduler;
    /** Choreography executor registry — features register the executors for the task types they own. */
    public readonly choreoSystem: ChoreoSystem;
    public readonly visualService: EntityVisualService;

    // ===== Widely-shared managers & systems (extracted from feature exports) =====
    public readonly carrierRegistry: CarrierRegistry;
    public readonly inventoryManager: BuildingInventoryManager;
    public readonly storageFilterManager: StorageFilterManager;
    public readonly demandLedger: DemandLedger;
    public readonly jobStore: TransportJobStore;
    public readonly buildingOverlayManager: BuildingOverlayManager;
    public readonly overlayRegistry: OverlayRegistry;
    public readonly constructionSiteManager: ConstructionSiteManager;
    public readonly workAreaStore: WorkAreaStore;
    public readonly settlerTaskSystem: SettlerTaskSystem;
    public readonly jobRunner: JobRunner;
    public readonly workerAssignments: WorkerAssignments;
    public readonly logisticsDispatcher: LogisticsDispatcher;
    public readonly garrisonManager: TowerGarrisonManager;
    public readonly treeSystem: TreeSystem;
    public readonly stoneSystem: StoneSystem;
    public readonly combatSystem: CombatSystem;
    public readonly siegeSystem: BuildingSiegeSystem;

    public readonly victorySystem: VictoryConditionsSystem;
    public readonly unitTransformer: UnitTransformer;
    public readonly recruitSystem: RecruitSystem;
    public readonly persistenceRegistry: PersistenceRegistry;
    public readonly territoryManager: TerritoryManager;

    // ===== Internal =====
    private readonly movement: MovementSystem;
    private readonly featureRegistry: FeatureRegistry;
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly cleanupRegistry = new EntityCleanupRegistry();
    private readonly mapObjectBlocking: MapObjectBlockingTracker;

    // ===== Shared kernel services =====
    public readonly unitReservation: UnitReservationRegistry;

    /**
     * @param terrain Map terrain — passed to every feature via FeatureContext at create() time.
     * @param resourceData Per-tile ore data from the map file; null for synthetic maps.
     * @param gameplaySettings Live gameplay-rule settings, passed to features via FeatureContext.
     */
    constructor(
        gameState: GameState,
        eventBus: EventBus,
        executeCommand: ExecuteCommand,
        terrain: TerrainData,
        resourceData: Uint8Array | null,
        gameplaySettings: GameplaySettings
    ) {
        // Movement is owned by GameState (constructed with terrain); exposed here for consumers.
        this.movement = gameState.movement;
        // 1. Kernel services — created before features, provided via FeatureContext.
        //    Removal order is declared by CLEANUP_PRIORITY (reservations release first).
        this.unitReservation = new UnitReservationRegistry(this.cleanupRegistry);
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

        // 1b. Choreography executor registry — filled by features during loadAll().
        this.choreoSystem = new ChoreoSystem();

        // 2. Feature registry — loads all game features in dependency order.
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            visualService: this.visualService,
            cleanupRegistry: this.cleanupRegistry,
            unitReservation: this.unitReservation,
            executeCommand,
            tickScheduler: this.tickScheduler,
            choreoSystem: this.choreoSystem,
            terrain,
            resourceData,
            gameplaySettings,
        });

        // 2a. Map object blocking — adds blocked tiles to buildingOccupancy so A* respects them.
        this.mapObjectBlocking = new MapObjectBlockingTracker(gameState.buildingOccupancy);
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, entityType, subType, x, y }) => {
            if (entityType === EntityType.MapObject) {
                this.mapObjectBlocking.add(entityId, subType, { x, y });
            }
        });
        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.mapObjectBlocking.remove(entityId);
        });

        // Create movement controllers for units on spawn (skip ephemeral angels and hidden units).
        // Hidden units (e.g. garrisoned soldiers restored from save) don't need controllers —
        // they'll get one when they exit the building via locationManager.exitBuilding().
        this.subscriptions.subscribe(
            eventBus,
            'entity:created',
            ({ entityId, entityType: type, subType, x, y, hidden }) => {
                if (type === EntityType.Unit && !isAngelUnitType(subType as UnitType) && !hidden) {
                    const speed = getUnitTypeSpeed(subType as UnitType);
                    this.movement.createController(entityId, { x, y }, speed);
                }
            }
        );

        // Remove movement controllers on entity removal
        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.movement.removeController(entityId);
        });

        // Kernel tick systems — tick order is fixed by phase, not registration order.
        this.featureRegistry.registerSystem(this.tickScheduler, TickPhase.Scheduler);
        this.featureRegistry.registerSystem(this.movement, TickPhase.Movement);

        // Listed in resolved load order (loadAll would sort dependencies first anyway).
        // Tick order is fixed by TickPhase; load order still fixes the order of event handlers
        // and cleanup handlers across features, so move a feature only after checking its subscriptions.
        this.featureRegistry.loadAll([
            // No feature dependencies
            InventoryFeature,
            WorkAreaFeature,
            CarrierFeature,
            DemandLedgerFeature,
            BuildingOverlayFeature,
            // Depends on inventory
            MaterialTransferFeature,
            // No feature dependencies
            CombatFeature,
            SettlerLocationFeature,
            OreVeinFeature,
            TerritoryFeature,
            // Depends on inventory, overlays, material-transfer, combat, settler-location, work-areas, territory
            SettlerTaskFeature,
            // Depend on settler-tasks (+ inventory / territory / ore-veins / carriers)
            ProductionControlFeature,
            TreeFeature,
            StoneFeature,
            CropFeature,
            OreSignFeature,
            RecruitFeature,
            // Depends on inventory / logistics / settler-tasks / recruit (worker dispatch)
            BuildingConstructionFeature,
            // Depends on construction + territory; no systems or subscriptions (owns place_building)
            BuildingPlacementFeature,
            // Depend on settler-tasks / territory / construction
            TerritoryConsequencesFeature,
            MaterialRequestFeature,
            PioneerFeature,
            // Depend on settler-tasks + recruit / construction
            LogisticsDispatcherFeature,
            BarracksFeature,
            TowerGarrisonFeature,
            BuildingSiegeFeature,
            BuildingDemandFeature,
            // Depend on construction / territory / victory-conditions
            VictoryConditionsFeature,
            AiPlayerFeature,
            FreePilesFeature,
        ]);

        // 3. Every task type a job can contain must have an executor by now — fail at startup, not mid-game.
        this.choreoSystem.assertAllRegistered();

        // 4. Extract widely-shared exports for external consumers (the rest: getFeature()).
        const inventoryExports = this.getFeature<InventoryExports>('inventory');
        this.inventoryManager = inventoryExports.inventoryManager;
        this.storageFilterManager = inventoryExports.storageFilterManager;
        this.carrierRegistry = this.getFeature<CarrierFeatureExports>('carriers').carrierRegistry;
        this.demandLedger = this.getFeature<DemandLedgerExports>('logistics').demandLedger;
        this.jobStore = this.getFeature<DemandLedgerExports>('logistics').jobStore;
        const overlayExports = this.getFeature<BuildingOverlayFeatureExports>('building-overlays');
        this.buildingOverlayManager = overlayExports.buildingOverlayManager;
        this.overlayRegistry = overlayExports.overlayRegistry;
        const constrExports = this.getFeature<BuildingConstructionExports>('building-construction');
        this.constructionSiteManager = constrExports.constructionSiteManager;
        this.workAreaStore = this.getFeature<WorkAreaExports>('work-areas').workAreaStore;
        const settlerTaskExports = this.getFeature<SettlerTaskExports>('settler-tasks');
        this.settlerTaskSystem = settlerTaskExports.settlerTaskSystem;
        this.jobRunner = settlerTaskExports.jobRunner;
        this.workerAssignments = settlerTaskExports.workerAssignments;
        this.logisticsDispatcher =
            this.getFeature<LogisticsDispatcherExports>('logistics-dispatcher').logisticsDispatcher;
        this.garrisonManager = this.getFeature<TowerGarrisonExports>('tower-garrison').garrisonManager;
        this.treeSystem = this.getFeature<TreeFeatureExports>('trees').treeSystem;
        this.stoneSystem = this.getFeature<StoneFeatureExports>('stones').stoneSystem;
        this.combatSystem = this.getFeature<CombatExports>('combat').combatSystem;
        this.siegeSystem = this.getFeature<BuildingSiegeExports>('building-siege').siegeSystem;
        this.victorySystem = this.getFeature<VictoryConditionsExports>('victory-conditions').victorySystem;
        const arExports = this.getFeature<RecruitExports>('recruit');

        this.unitTransformer = arExports.unitTransformer;
        this.recruitSystem = arExports.recruitSystem;
        this.territoryManager = this.getFeature<TerritoryExports>('territory').territoryManager;

        // 5. Persistence registry — register feature-declared persistables first, then manual ones.
        this.persistenceRegistry = new PersistenceRegistry();
        for (const { persistable, after } of this.featureRegistry.getPersistables()) {
            this.persistenceRegistry.register(persistable, after);
        }
        // Pile state derived from inventory slots — no separate persistence needed.

        // 6. Core entity lifecycle — too small to be a feature.
        //    (Inventory registers its own pile / slot cleanup, see InventoryFeature.)
        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.visualService.remove(entityId);
        });

        // Wire the registry to the event bus — single subscription drives all cleanup handlers.
        this.cleanupRegistry.registerEvents(eventBus);
    }

    /**
     * Typed lookup of a loaded feature's exports, for consumers (UI, debug, CLI, tests)
     * that need a feature service without a dedicated field. Throws if not loaded.
     *
     * @example services.getFeature<BarracksExports>('barracks').barracksTrainingManager
     */
    public getFeature<T>(featureId: string): T {
        return this.featureRegistry.getFeatureExports<T>(featureId);
    }

    /** Tick systems in tick order (by phase), for the frame loop. */
    public getTickSystems(): readonly PhasedTickSystem[] {
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
}

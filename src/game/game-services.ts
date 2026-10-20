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

// Feature definitions
import { WorkAreaFeature, type WorkAreaExports } from './features/work-areas/work-areas-feature';
import { ProductionControlFeature, type ProductionControlExports } from './features/production-control';
import { CarrierFeature, type CarrierFeatureExports } from './features/carriers';
import { DemandLedgerFeature, type DemandLedgerExports } from './features/logistics';
import { BuildingOverlayFeature, type BuildingOverlayFeatureExports } from './features/building-overlays';
import { BuildingConstructionFeature, type BuildingConstructionExports } from './features/building-construction';
import { MaterialRequestFeature } from './features/material-requests';
import { TreeFeature, type TreeFeatureExports } from './features/trees';
import { StoneFeature, type StoneFeatureExports } from './features/stones';
import { CropFeature } from './features/crops';
import { CombatFeature, type CombatExports } from './features/combat';
import { OreSignFeature, OreVeinFeature, type OreSignExports, type OreVeinExports } from './features/ore-veins';
import { MaterialTransferFeature } from './features/material-transfer/material-transfer-feature';
import { SettlerTaskFeature, type SettlerTaskExports } from './features/settler-tasks';
import { RecruitFeature, type RecruitExports } from './features/recruit';
import { BuildingDemandFeature } from './features/building-demand/building-demand-feature';
import { ConstructionDemandFeature } from './features/building-construction/construction-demand-feature';
import type { UnitTransformer, RecruitSystem } from './features/recruit';

import {
    LogisticsDispatcherFeature,
    type LogisticsDispatcherExports,
} from './features/logistics/logistics-dispatcher-feature';
import { BarracksFeature, type BarracksExports } from './features/barracks/barracks-feature';
import { TowerGarrisonFeature, type TowerGarrisonExports } from './features/tower-garrison';
import { SettlerLocationFeature } from './features/settler-location';
import type { SettlerLocationExports } from './features/settler-location';
import { InventoryFeature, FreePilesFeature, type InventoryExports } from './features/inventory';
import { TerritoryFeature, TerritoryConsequencesFeature, type TerritoryExports } from './features/territory';
import { VictoryConditionsFeature, type VictoryConditionsExports } from './features/victory-conditions';
import { BuildingSiegeFeature, type BuildingSiegeExports, TowerAssaultSystem } from './features/building-siege';
import type { BuildingSiegeSystem } from './features/building-siege/building-siege-system';
import { AiPlayerFeature, type AiPlayerExports } from './features/ai-player';
import { PioneerFeature } from './features/pioneer';

// Re-export types that external code imports transitively via GameServices
import type { CarrierRegistry } from './features/carriers';
import type { BuildingInventoryManager, StorageFilterManager, BuildingPileRegistry } from './features/inventory';
import type { DemandLedger, TransportJobStore, LogisticsDispatcher } from './features/logistics';
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
import type { ISettlerBuildingLocationManager } from './features/settler-location';
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
    public readonly demandLedger: DemandLedger;
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
    public readonly towerAssaultSystem: TowerAssaultSystem;
    public readonly signSystem: ResourceSignSystem;
    public readonly locationManager: ISettlerBuildingLocationManager;

    public readonly victorySystem: VictoryConditionsSystem;
    public readonly unitTransformer: UnitTransformer;
    public readonly recruitSystem: RecruitSystem;
    public readonly pileRegistry: BuildingPileRegistry;
    public readonly aiSystem: AiPlayerSystem;
    public readonly persistenceRegistry: PersistenceRegistry;
    public readonly territoryManager: TerritoryManager;
    public readonly oreVeinData: OreVeinData;

    // ===== Internal =====
    private readonly featureRegistry: FeatureRegistry;
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly cleanupRegistry = new EntityCleanupRegistry();
    private readonly mapObjectBlocking: MapObjectBlockingTracker;

    // ===== Shared kernel services (also exposed for command registration) =====
    public readonly unitReservation: UnitReservationRegistry;

    /**
     * @param terrain Map terrain — passed to every feature via FeatureContext at create() time.
     * @param resourceData Per-tile ore data from the map file; null for synthetic maps.
     */
    constructor(
        gameState: GameState,
        eventBus: EventBus,
        executeCommand: ExecuteCommand,
        terrain: TerrainData,
        resourceData: Uint8Array | null
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

        // 2. Feature registry — loads all game features in dependency order.
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            visualService: this.visualService,
            cleanupRegistry: this.cleanupRegistry,
            unitReservation: this.unitReservation,
            executeCommand,
            tickScheduler: this.tickScheduler,
            terrain,
            resourceData,
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
        // Tick systems tick in this order, so keep system-owning features where they are.
        this.featureRegistry.loadAll([
            // No feature dependencies
            InventoryFeature,
            WorkAreaFeature,
            ProductionControlFeature,
            CarrierFeature,
            DemandLedgerFeature,
            BuildingOverlayFeature,
            // Depend on inventory / logistics
            BuildingConstructionFeature,
            MaterialTransferFeature,
            // No feature dependencies
            CombatFeature,
            SettlerLocationFeature,
            OreVeinFeature,
            TerritoryFeature,
            // Depends on construction, material-transfer, combat, settler-location, ore-veins, territory
            SettlerTaskFeature,
            // Depend on settler-tasks (+ territory / ore-veins / carriers)
            TreeFeature,
            StoneFeature,
            CropFeature,
            OreSignFeature,
            RecruitFeature,
            TerritoryConsequencesFeature,
            MaterialRequestFeature,
            PioneerFeature,
            // Depend on settler-tasks + recruit / construction
            LogisticsDispatcherFeature,
            BarracksFeature,
            TowerGarrisonFeature,
            BuildingSiegeFeature,
            BuildingDemandFeature,
            ConstructionDemandFeature,
            // Depend on construction / territory / victory-conditions
            VictoryConditionsFeature,
            AiPlayerFeature,
            FreePilesFeature,
        ]);

        // 4. Extract commonly-accessed exports for external consumers.
        const inventoryExports = this.feat<InventoryExports>('inventory');
        this.inventoryManager = inventoryExports.inventoryManager;
        this.storageFilterManager = inventoryExports.storageFilterManager;
        this.carrierRegistry = this.feat<CarrierFeatureExports>('carriers').carrierRegistry;
        this.demandLedger = this.feat<DemandLedgerExports>('logistics').demandLedger;
        this.jobStore = this.feat<DemandLedgerExports>('logistics').jobStore;
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
        this.towerAssaultSystem = this.feat<BuildingSiegeExports>('building-siege').towerAssaultSystem;
        this.signSystem = this.feat<OreSignExports>('ore-signs').signSystem;
        this.locationManager = this.feat<SettlerLocationExports>('settler-location').locationManager;
        this.victorySystem = this.feat<VictoryConditionsExports>('victory-conditions').victorySystem;
        const arExports = this.feat<RecruitExports>('recruit');

        this.unitTransformer = arExports.unitTransformer;
        this.aiSystem = this.feat<AiPlayerExports>('ai-player').aiSystem;
        this.recruitSystem = arExports.recruitSystem;
        this.pileRegistry = constrExports.pileRegistry;
        this.territoryManager = this.feat<TerritoryExports>('territory').territoryManager;
        this.oreVeinData = this.feat<OreVeinExports>('ore-veins').oreVeinData;

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

    private feat<T>(featureId: string): T {
        return this.featureRegistry.getFeatureExports<T>(featureId);
    }
}

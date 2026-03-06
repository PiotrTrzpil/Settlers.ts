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
import type { TickSystem } from './tick-system';
import { EntityType } from './entity';
import { EventBus, EventSubscriptionManager } from './event-bus';
import { EntityVisualService } from './animation/entity-visual-service';
import type { Command, CommandResult } from './commands';
import { EntityCleanupRegistry, CLEANUP_PRIORITY } from './systems/entity-cleanup-registry';
import { FeatureRegistry } from './features/feature-registry';
import { PersistenceRegistry } from './persistence';

// Feature definitions
import { MovementFeature, type MovementExports } from './features/movement/movement-feature';
import { WorkAreaFeature, type WorkAreaExports } from './features/work-areas/work-areas-feature';
import {
    ProductionControlFeature,
    type ProductionControlExports,
} from './features/production-control/production-control-feature';
import { CarrierFeature, type CarrierFeatureExports } from './features/carriers';
import { InventoryFeature, type InventoryExports } from './features/inventory';
import { RequestManagerFeature, type RequestManagerExports } from './features/logistics';
import { BuildingOverlayFeature, type BuildingOverlayFeatureExports } from './features/building-overlays';
import {
    BuildingConstructionFeature,
    type BuildingConstructionExports,
} from './features/building-construction/building-construction-feature';
import { MaterialRequestFeature } from './features/material-requests';
import { TreeFeature, type TreeFeatureExports } from './features/trees';
import { StoneFeature, type StoneFeatureExports } from './features/stones';
import { CropFeature, type CropFeatureExports } from './features/crops';
import { CombatFeature, type CombatExports } from './features/combat';
import { DeathAngelFeature } from './features/death-angel';
import { OreSignFeature, type OreSignExports } from './features/ore-veins';
import {
    MaterialTransferFeature,
    type MaterialTransferExports,
} from './features/material-transfer/material-transfer-feature';
import { SettlerTaskFeature, type SettlerTaskExports } from './features/settler-tasks/settler-tasks-feature';
import { AutoRecruitFeature, type AutoRecruitExports } from './features/auto-recruit';
import type { AutoRecruitSystem } from './features/auto-recruit';
import {
    LogisticsDispatcherFeature,
    type LogisticsDispatcherExports,
} from './features/logistics/logistics-dispatcher-feature';
import { BarracksFeature, type BarracksExports } from './features/barracks/barracks-feature';
import {
    InventoryPileSyncFeature,
    type InventoryPileSyncExports,
} from './features/inventory/inventory-pile-sync-feature';
import { FreePilesFeature } from './features/free-piles/free-piles-feature';
import { TerritoryFeature, type TerritoryExports } from './features/territory/territory-feature';

// Re-export types that external code imports transitively via GameServices
import type { MovementSystem } from './systems/movement';
import type { CarrierRegistry } from './features/carriers';
import type { BuildingInventoryManager, StorageFilterManager, InventoryPileSync } from './features/inventory';
import type { RequestManager, LogisticsDispatcher } from './features/logistics';
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
import type { MaterialTransfer } from './features/material-transfer';
import type { TreeSystem } from './features/trees';
import type { StoneSystem } from './features/stones';
import type { CropSystem } from './features/crops';
import type { CombatSystem } from './features/combat';
import type { OreVeinData, ResourceSignSystem } from './features/ore-veins';
import type { SettlerTaskSystem } from './features/settler-tasks';

export class GameServices {
    // ===== Kernel services =====
    public readonly visualService: EntityVisualService;

    // ===== Managers & systems (extracted from feature exports) =====
    public readonly movement: MovementSystem;
    public readonly carrierRegistry: CarrierRegistry;
    public readonly inventoryManager: BuildingInventoryManager;
    public readonly storageFilterManager: StorageFilterManager;
    public readonly requestManager: RequestManager;
    public readonly buildingOverlayManager: BuildingOverlayManager;
    public readonly overlayRegistry: OverlayRegistry;
    public readonly constructionSiteManager: ConstructionSiteManager;
    public readonly constructionSystem: BuildingConstructionSystem;
    public readonly residenceSpawner: ResidenceSpawnerSystem;
    public readonly workAreaStore: WorkAreaStore;
    public readonly productionControlManager: ProductionControlManager;
    public readonly materialTransfer: MaterialTransfer;
    public readonly settlerTaskSystem: SettlerTaskSystem;
    public readonly logisticsDispatcher: LogisticsDispatcher;
    public readonly barracksTrainingManager: BarracksTrainingManager;
    public readonly treeSystem: TreeSystem;
    public readonly stoneSystem: StoneSystem;
    public readonly cropSystem: CropSystem;
    public readonly combatSystem: CombatSystem;
    public readonly signSystem: ResourceSignSystem;
    public readonly autoRecruitSystem: AutoRecruitSystem;
    public readonly inventoryPileSync: InventoryPileSync | null;
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

    constructor(gameState: GameState, eventBus: EventBus, executeCommand: (cmd: Command) => CommandResult) {
        // 1. Kernel services — created before features, provided via FeatureContext.
        //    Visual init handler MUST fire before any feature handler (subscribed first).
        this.visualService = new EntityVisualService();
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, variation }) =>
            this.visualService.init(entityId, variation)
        );

        // 2. Feature registry — loads all game features in dependency order.
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            visualService: this.visualService,
            cleanupRegistry: this.cleanupRegistry,
            executeCommand,
        });

        this.featureRegistry.loadAll([
            // Tier 0: no dependencies
            MovementFeature,
            WorkAreaFeature,
            ProductionControlFeature,
            CarrierFeature,
            InventoryFeature,
            RequestManagerFeature,
            BuildingOverlayFeature,
            TreeFeature,
            StoneFeature,
            CropFeature,
            CombatFeature,
            DeathAngelFeature,
            OreSignFeature,
            TerritoryFeature,
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
            AutoRecruitFeature,
            // Independent chains
            InventoryPileSyncFeature,
            FreePilesFeature,
        ]);

        // 3. Extract commonly-accessed exports for external consumers.
        this.movement = this.feat<MovementExports>('movement').movement;
        this.carrierRegistry = this.feat<CarrierFeatureExports>('carriers').carrierRegistry;
        const invExports = this.feat<InventoryExports>('inventory');
        this.inventoryManager = invExports.inventoryManager;
        this.storageFilterManager = invExports.storageFilterManager;
        this.requestManager = this.feat<RequestManagerExports>('logistics').requestManager;
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
        this.materialTransfer = this.feat<MaterialTransferExports>('material-transfer').materialTransfer;
        this.settlerTaskSystem = this.feat<SettlerTaskExports>('settler-tasks').settlerTaskSystem;
        this.logisticsDispatcher = this.feat<LogisticsDispatcherExports>('logistics-dispatcher').logisticsDispatcher;
        this.barracksTrainingManager = this.feat<BarracksExports>('barracks').barracksTrainingManager;
        this.treeSystem = this.feat<TreeFeatureExports>('trees').treeSystem;
        this.stoneSystem = this.feat<StoneFeatureExports>('stones').stoneSystem;
        this.cropSystem = this.feat<CropFeatureExports>('crops').cropSystem;
        this.combatSystem = this.feat<CombatExports>('combat').combatSystem;
        this.signSystem = this.feat<OreSignExports>('ore-signs').signSystem;
        this.autoRecruitSystem = this.feat<AutoRecruitExports>('auto-recruit').autoRecruitSystem;
        const pileSyncExports = this.feat<InventoryPileSyncExports>('inventory-pile-sync');
        this.inventoryPileSync = pileSyncExports.inventoryPileSync;

        // 4. Persistence registry — register all Persistable managers in dependency order.
        this.persistenceRegistry = new PersistenceRegistry();
        this.persistenceRegistry.register(this.constructionSiteManager);
        this.persistenceRegistry.register(this.carrierRegistry);
        this.persistenceRegistry.register(this.workAreaStore);
        this.persistenceRegistry.register(this.treeSystem);
        this.persistenceRegistry.register(this.stoneSystem);
        this.persistenceRegistry.register(gameState.piles);
        this.persistenceRegistry.register(this.inventoryManager, ['constructionSites']);
        this.persistenceRegistry.register(this.requestManager, ['constructionSites']);
        this.persistenceRegistry.register(this.cropSystem);
        this.persistenceRegistry.register(this.storageFilterManager);
        this.persistenceRegistry.register(this.combatSystem);
        this.persistenceRegistry.register(this.signSystem);
        this.persistenceRegistry.register(this.residenceSpawner);
        this.persistenceRegistry.register(this.productionControlManager);
        this.persistenceRegistry.register(this.barracksTrainingManager, ['productionControl']);
        this.persistenceRegistry.register(this.autoRecruitSystem);
        this.persistenceRegistry.register(this.settlerTaskSystem, [
            'carriers',
            'constructionSites',
            'buildingInventories',
        ]);

        // 5. Wire pile registry to settler-tasks (cross-feature, conditional).
        if (pileSyncExports.pileRegistry) {
            this.feat<SettlerTaskExports>('settler-tasks').setPileRegistry(pileSyncExports.pileRegistry);
        }

        // 6. Core entity lifecycle — too small to be a feature.
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, type }) => {
            if (type === EntityType.StackedPile) {
                gameState.piles.createState(entityId);
            }
        });

        this.cleanupRegistry.onEntityRemoved(entityId => {
            this.visualService.remove(entityId);
            gameState.piles.removeState(entityId);
        });

        // 7. Late inventory removal — MUST happen after logistics cleanup.
        this.cleanupRegistry.onEntityRemoved(
            this.inventoryManager.destroyBuildingInventory.bind(this.inventoryManager),
            CLEANUP_PRIORITY.LATE
        );

        // Wire the registry to the event bus — single subscription drives all cleanup handlers.
        this.cleanupRegistry.registerEvents(eventBus);
    }

    /** Provide terrain data to all features that need it. */
    public setTerrainData(terrain: TerrainData, resourceData?: Uint8Array): void {
        this.featureRegistry.setTerrainData(terrain, resourceData);
    }

    /** Ordered tick systems for the frame loop, with group labels. */
    public getTickSystems(): readonly { system: TickSystem; group: string }[] {
        return this.featureRegistry.getSystems();
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

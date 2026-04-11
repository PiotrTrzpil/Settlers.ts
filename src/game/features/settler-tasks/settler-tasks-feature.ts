/**
 * SettlerTask Feature -- wraps SettlerTaskSystem and all work handlers
 * as a self-registering feature.
 *
 * Work handlers that need terrain (water) are registered in onTerrainReady.
 * Domain features (trees, stones, crops, ore-signs) register their own handlers.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { BuildingOverlayFeatureExports } from '../building-overlays';
import type { BuildingConstructionExports } from '../building-construction';
import type { WorkAreaExports } from '../work-areas/work-areas-feature';
import type { ProductionControlExports } from '../production-control';
import type { MaterialTransferExports } from '../material-transfer/material-transfer-feature';
import type { CombatExports } from '../combat';
import type { BuildingPileRegistry } from '../inventory';
import type { SettlerLocationExports } from '../settler-location';
import type { TerrainData } from '../../terrain';
import { SettlerTaskSystem, SearchType } from './index';
import { ChoreoSystem } from '../../systems/choreo';
import { createWaterHandler } from './work-handlers';
import { createSettlerTaskPersistence } from './settler-task-persistence';

export interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
    /** Shared choreography executor registry — features register task types here. */
    choreoSystem: ChoreoSystem;
    /** Inject BuildingPileRegistry once game data is loaded. */
    setPileRegistry: (registry: BuildingPileRegistry) => void;
}

export const SettlerTaskFeature: FeatureDefinition = {
    id: 'settler-tasks',
    dependencies: [
        'inventory',
        'building-overlays',
        'building-construction',
        'work-areas',
        'production-control',
        'material-transfer',
        'combat',
        'settler-location',
    ],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { buildingOverlayManager } = ctx.getFeature<BuildingOverlayFeatureExports>('building-overlays');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { workAreaStore } = ctx.getFeature<WorkAreaExports>('work-areas');
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { materialTransfer } = ctx.getFeature<MaterialTransferExports>('material-transfer');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');

        // BuildingPileRegistry (XML pile positions) -- conditionally set later when game data loads.
        // The lazy getter in SettlerTaskSystem tolerates null until then.
        let pileRegistry: BuildingPileRegistry | null = null;

        // Shared choreography executor registry — core executors registered in WorkerTaskExecutor ctor;
        // domain features (recruit) register their task types after create() runs.
        const choreoSystem = new ChoreoSystem();

        const settlerTaskSystem = new SettlerTaskSystem({
            tickScheduler: ctx.tickScheduler,
            choreoSystem,
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            inventoryManager,
            eventBus: ctx.eventBus,
            getPileRegistry: () => pileRegistry,
            workAreaStore,
            buildingOverlayManager,
            getProductionControlManager: () => productionControlManager,
            constructionSiteManager,
            executeCommand: ctx.executeCommand,
            materialTransfer,
            isInCombat: combatSystem.isInCombat.bind(combatSystem),
            locationManager,
        });

        const exports: SettlerTaskExports = {
            settlerTaskSystem,
            choreoSystem,
            setPileRegistry: (registry: BuildingPileRegistry) => {
                pileRegistry = registry;
            },
        };

        const settlerTaskPersistence = createSettlerTaskPersistence({
            gameState: ctx.gameState,
            runtimes: settlerTaskSystem.runtimes,
            workerTracker: settlerTaskSystem.workerTracker,
            choreographyStore: settlerTaskSystem.getChoreographyStore(),
            getOrCreateRuntime: id => settlerTaskSystem.getOrCreateRuntime(id),
        });

        return {
            systems: [settlerTaskSystem],
            systemGroup: 'Units',
            exports,
            persistence: [{ persistable: settlerTaskPersistence, after: ['constructionSites'] }],
            onTerrainReady(terrain: TerrainData) {
                // Water handler -- needs terrain to find river tiles
                settlerTaskSystem.registerWorkHandler(SearchType.WATER, createWaterHandler(terrain));
            },
        };
    },
};

/**
 * SettlerTask Feature -- wraps SettlerTaskSystem and all work handlers
 * as a self-registering feature.
 *
 * The water handler (needs terrain) is registered here. Domain features
 * (trees, stones, crops, ore-signs, pioneer) register their own handlers.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { BuildingOverlayFeatureExports } from '../building-overlays';
import type { BuildingConstructionExports } from '../building-construction';
import type { WorkAreaExports } from '../work-areas/work-areas-feature';
import type { ProductionControlExports } from '../production-control';
import type { MaterialTransferExports } from '../material-transfer/material-transfer-feature';
import type { CombatExports } from '../combat';
import type { SettlerLocationExports } from '../settler-location';
import type { OreVeinExports } from '../ore-veins';
import type { TerritoryExports } from '../territory';
import { SettlerTaskSystem, SearchType } from './index';
import { ChoreoSystem } from '../../systems/choreo';
import { createWaterHandler } from './work-handlers';
import { createSettlerTaskPersistence } from './settler-task-persistence';
import { TickPhase } from '../../core/tick-phase';

export interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
    /** Shared choreography executor registry — features register task types here. */
    choreoSystem: ChoreoSystem;
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
        'ore-veins',
        'territory',
    ],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { buildingOverlayManager } = ctx.getFeature<BuildingOverlayFeatureExports>('building-overlays');
        const { constructionSiteManager, pileRegistry } =
            ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { workAreaStore } = ctx.getFeature<WorkAreaExports>('work-areas');
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { materialTransfer } = ctx.getFeature<MaterialTransferExports>('material-transfer');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');
        const { oreVeinData } = ctx.getFeature<OreVeinExports>('ore-veins');
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

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
            pileRegistry,
            workAreaStore,
            buildingOverlayManager,
            getProductionControlManager: () => productionControlManager,
            constructionSiteManager,
            executeCommand: ctx.executeCommand,
            materialTransfer,
            isInCombat: combatSystem.isInCombat.bind(combatSystem),
            locationManager,
            oreVeinData,
            territoryCheck: (a, b, player) => territoryManager.areConnected(a, b, player),
        });

        // Water handler -- needs terrain to find river tiles
        settlerTaskSystem.registerWorkHandler(SearchType.WATER, createWaterHandler(ctx.terrain));

        const exports: SettlerTaskExports = { settlerTaskSystem, choreoSystem };

        const settlerTaskPersistence = createSettlerTaskPersistence({
            gameState: ctx.gameState,
            runtimes: settlerTaskSystem.runtimes,
            workerTracker: settlerTaskSystem.workerTracker,
            choreographyStore: settlerTaskSystem.getChoreographyStore(),
            getOrCreateRuntime: id => settlerTaskSystem.getOrCreateRuntime(id),
        });

        return {
            systems: [settlerTaskSystem],
            tickPhase: TickPhase.SettlerTasks,
            exports,
            persistence: [{ persistable: settlerTaskPersistence, after: ['constructionSites'] }],
        };
    },
};

/**
 * SettlerTask Feature -- wraps SettlerTaskSystem and all work handlers
 * as a self-registering feature.
 *
 * The water handler (needs terrain) is registered here. Domain features
 * (production-control, trees, stones, crops, ore-signs, pioneer) register their own handlers.
 * Only domain-free choreography executors are registered here (see choreo-executors.ts).
 *
 * Commands: move_unit, move_selected_units (player moves become move tasks).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { BuildingOverlayFeatureExports } from '../building-overlays';
import type { WorkAreaExports } from '../work-areas/work-areas-feature';
import type { MaterialTransferExports } from '../material-transfer/material-transfer-feature';
import type { CombatExports } from '../combat';
import type { SettlerLocationExports } from '../settler-location';
import type { TerritoryExports } from '../territory';
import { SettlerTaskSystem, SearchType } from './index';
import { createWaterHandler } from './work-handlers';
import { createSettlerTaskPersistence } from './settler-task-persistence';
import { TickPhase } from '../../core/tick-phase';
import type { MoveUnitCommand, MoveSelectedUnitsCommand } from '../../commands/command-types';
import { executeMoveUnit, executeMoveSelectedUnits, type MoveCommandDeps } from './move-commands';

export interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
}

export const SettlerTaskFeature: FeatureDefinition = {
    id: 'settler-tasks',
    dependencies: [
        // Workplace output-capacity checks + pile positions
        'inventory',
        // Work-node triggers → building overlay animations
        'building-overlays',
        // Work-area centers for useWork offsets / search areas
        'work-areas',
        // Drop carried goods on job interrupt
        'material-transfer',
        // isInCombat gate + move commands
        'combat',
        'settler-location',
        'territory',
    ],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { triggerSystem } = ctx.getFeature<BuildingOverlayFeatureExports>('building-overlays');
        const { workAreaStore } = ctx.getFeature<WorkAreaExports>('work-areas');
        const { materialTransfer } = ctx.getFeature<MaterialTransferExports>('material-transfer');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

        const settlerTaskSystem = new SettlerTaskSystem({
            tickScheduler: ctx.tickScheduler,
            choreoSystem: ctx.choreoSystem,
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            inventoryManager,
            eventBus: ctx.eventBus,
            workAreaStore,
            triggerSystem,
            materialTransfer,
            isInCombat: combatSystem.isInCombat.bind(combatSystem),
            locationManager,
            territoryCheck: (a, b, player) => territoryManager.areConnected(a, b, player),
        });

        // Water handler -- needs terrain to find river tiles
        settlerTaskSystem.registerWorkHandler(SearchType.WATER, createWaterHandler(ctx.terrain));

        const exports: SettlerTaskExports = { settlerTaskSystem };

        const settlerTaskPersistence = createSettlerTaskPersistence({
            gameState: ctx.gameState,
            runtimes: settlerTaskSystem.runtimes,
            workerTracker: settlerTaskSystem.workerTracker,
            choreographyStore: settlerTaskSystem.getChoreographyStore(),
            getOrCreateRuntime: id => settlerTaskSystem.getOrCreateRuntime(id),
        });

        const moveDeps: MoveCommandDeps = {
            state: ctx.gameState,
            settlerTaskSystem,
            combatSystem,
            unitReservation: ctx.unitReservation,
            isCombatControllable: () => ctx.gameplaySettings.combatControllable,
            getOwner: tile => territoryManager.getOwner(tile),
        };

        return {
            systems: [settlerTaskSystem],
            tickPhase: TickPhase.SettlerTasks,
            exports,
            persistence: [{ persistable: settlerTaskPersistence, after: ['constructionSites'] }],
            commands: {
                move_unit: cmd => executeMoveUnit(moveDeps, cmd as MoveUnitCommand),
                move_selected_units: cmd => executeMoveSelectedUnits(moveDeps, cmd as MoveSelectedUnitsCommand),
            },
        };
    },
};

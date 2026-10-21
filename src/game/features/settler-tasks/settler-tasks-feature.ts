/**
 * SettlerTask Feature -- wraps SettlerTaskSystem and all work handlers
 * as a self-registering feature.
 *
 * Exports the system plus its peers that other features use directly:
 * JobService (job ownership: registerKind / assign / cancel / hold), JobRunner
 * (TaskDispatcher / WorkerStateQuery) and WorkerAssignments.
 *
 * Claims the unit-commitment write side (only JobService writes commitments) and registers
 * the COMMITMENTS-priority unit-removal handler. `onRestoreResume` resumes restored jobs.
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
import { SettlerTaskSystem } from './settler-task-system';
import type { JobRunner } from './job-runner';
import type { WorkerAssignments } from './worker-assignments';
import type { JobService } from './job-service';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import { SearchType } from './types';
import { createWaterHandler } from './work-handlers';
import { createSettlerTaskPersistence } from './settler-task-persistence';
import { TickPhase } from '../../core/tick-phase';
import type { MoveUnitCommand, MoveSelectedUnitsCommand } from '../../commands/command-types';
import { executeMoveUnit, executeMoveSelectedUnits, type MoveCommandDeps } from './move-commands';

export interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
    /** Job ownership: register a JobKind handler / hold owner, assign / cancel / hold units, commitments. */
    jobs: JobService;
    /** Move-task assignment and TRANSITIONAL legacy assignJob (TaskDispatcher); job-state queries. */
    jobRunner: JobRunner;
    /** Home-building assignments, occupant counts, idle-specialist lookup. */
    workerAssignments: WorkerAssignments;
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

        const commitmentWriter = ctx.claimUnitCommitmentWriter();
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
            commitments: ctx.unitCommitments,
            commitmentWriter,
        });

        // Unit removal reaches the job / commitment owner before every other cleanup handler.
        ctx.cleanupRegistry.onEntityRemoved(
            (entityId, entity) => settlerTaskSystem.unitRemoval.onEntityRemoved(entityId, entity),
            CLEANUP_PRIORITY.COMMITMENTS
        );

        // Water handler -- needs terrain to find river tiles
        settlerTaskSystem.registerWorkHandler(SearchType.WATER, createWaterHandler(ctx.terrain));

        const { jobRunner, jobs, assignments: workerAssignments } = settlerTaskSystem;
        const exports: SettlerTaskExports = { settlerTaskSystem, jobs, jobRunner, workerAssignments };

        const settlerTaskPersistence = createSettlerTaskPersistence({
            gameState: ctx.gameState,
            runtimes: settlerTaskSystem.runtimes,
            assignments: workerAssignments,
            owners: settlerTaskSystem.owners,
            commitments: ctx.unitCommitments,
            commitmentWriter,
            moveTasks: settlerTaskSystem.moveTasks,
            pendingResumes: settlerTaskSystem.pendingResumes,
        });

        const moveDeps: MoveCommandDeps = {
            state: ctx.gameState,
            taskDispatcher: jobRunner,
            combatSystem,
            unitReservation: ctx.unitCommitments,
            isCombatControllable: () => ctx.gameplaySettings.combatControllable,
            getOwner: tile => territoryManager.getOwner(tile),
        };

        return {
            systems: [settlerTaskSystem],
            tickPhase: TickPhase.SettlerTasks,
            exports,
            persistence: [{ persistable: settlerTaskPersistence, after: ['constructionSites'] }],
            onRestoreResume: () => settlerTaskSystem.resumeRestoredJobs(),
            commands: {
                move_unit: cmd => executeMoveUnit(moveDeps, cmd as MoveUnitCommand),
                move_selected_units: cmd => executeMoveSelectedUnits(moveDeps, cmd as MoveSelectedUnitsCommand),
            },
        };
    },
};

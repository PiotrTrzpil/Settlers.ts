/**
 * BuildingConstruction Feature — consolidates all construction systems into
 * a single self-registering feature.
 *
 * Wraps:
 * - ConstructionSiteManager (construction site state)
 * - BuildingConstructionSystem (terrain modification, phase transitions)
 * - ResidenceSpawnerSystem (carrier spawning from residences)
 * - ConstructionRequestSystem (material delivery demands for construction)
 * - ConstructionWorkerDemands + ConstructionSiteDemandSystem (digger/builder demand and dispatch)
 * - the `Construction` JobKind handler (owned dig / build jobs, optionally with a recruit prefix)
 * - BuildingLifecycleHandler (event-driven domain handlers)
 * - BuildingPileRegistry + PilePositionResolver (pile tiles, fixed at slot creation)
 * - DIG_TILE / BUILD_STEP choreo executors (irreversible node hooks)
 *
 * Commands: spawn_building_units (issued by BuildingConstructionSystem on completion).
 *
 * Tick phases: the construction systems run in TickPhase.Construction; the worker demand
 * system in TickPhase.ConstructionDemand (after BuildingDemandSystem).
 *
 * Load order: depends on settler-tasks + recruit (worker dispatch), so it loads after them.
 * Its building:completed / building:removed / cleanup handlers therefore run after those of
 * territory, settler-location, production-control and combat — all of which only touch their
 * own state for these events, so the relative order is not observable.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { DemandLedgerExports } from '../logistics/demand-ledger-feature';
import type { SettlerTaskExports } from '../settler-tasks';
import { SearchType, WorkHandlerType } from '../settler-tasks/types';
import type { RecruitExports } from '../recruit';
import { JobKind } from '../../systems/choreo';
import { createConstructionJobKind, type ConstructionJobParams } from './construction-job-kind';
import { ConstructionSiteManager } from './construction-site-manager';
import { ConstructionWorkerDemands } from './construction-worker-demands';
import { ConstructionSiteDemandSystem } from './construction-site-demand';
import { registerConstructionExecutors } from './internal/construction-executors';
import { BuildingConstructionSystem } from './construction-system';
import { ResidenceSpawnerSystem } from './residence-spawner';
import { ConstructionRequestSystem } from './construction-request-system';
import { BuildingLifecycleHandler } from './building-lifecycle-feature';
import { getGameDataLoader } from '@/resources/game-data';
import { BuildingPileRegistry, PilePositionResolver } from '../inventory';
import { TickPhase } from '../../core/tick-phase';
import type { SpawnBuildingUnitsCommand } from '../../commands/command-types';
import { executeSpawnBuildingUnits } from './internal/spawn-building-units-command';

export interface BuildingConstructionExports {
    constructionSiteManager: ConstructionSiteManager;
    constructionSystem: BuildingConstructionSystem;
    constructionRequestSystem: ConstructionRequestSystem;
    residenceSpawner: ResidenceSpawnerSystem;
    pileRegistry: BuildingPileRegistry;
    constructionWorkerDemands: ConstructionWorkerDemands;
}

/**
 * Create the worker demand system (idle specialists via settler-tasks, carrier recruitment via
 * recruit) and register it as the owner of the `Construction` job kind.
 * Builders and diggers are dispatched by this system, not by the idle-scan work-handler path — the
 * no-op CONSTRUCTION / CONSTRUCTION_DIG handlers only suppress "No work handler registered" warnings.
 */
function createConstructionDemandSystem(
    ctx: FeatureContext,
    siteManager: ConstructionSiteManager,
    demands: ConstructionWorkerDemands
): ConstructionSiteDemandSystem {
    const { settlerTaskSystem, jobs, workerAssignments } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
    const { recruitSystem, recruitSegments } = ctx.getFeature<RecruitExports>('recruit');

    const noopHandler = { type: WorkHandlerType.NULL as const, shouldWaitForWork: true };
    settlerTaskSystem.registerWorkHandler(SearchType.CONSTRUCTION, noopHandler);
    settlerTaskSystem.registerWorkHandler(SearchType.CONSTRUCTION_DIG, noopHandler);

    const system = new ConstructionSiteDemandSystem({
        gameState: ctx.gameState,
        eventBus: ctx.eventBus,
        siteManager,
        demands,
        findIdleSpecialist: (unitType, player, nearX, nearY) =>
            workerAssignments.findIdleSpecialist(unitType, player, nearX, nearY),
        jobs,
        dispatchRecruitment: (unitType, player, opts) => recruitSystem.dispatchRecruitment(unitType, player, opts),
    });
    jobs.registerKind(createConstructionJobKind(recruitSegments, system));
    return system;
}

/** Restore: the params of every restored Construction job, by ascending unit id (jobs not built yet). */
function restoredConstructionWorkers(ctx: FeatureContext): Map<number, ConstructionJobParams> {
    const { jobs } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
    const workers = new Map<number, ConstructionJobParams>();
    for (const unitId of jobs.commitments.unitsOwnedBy(JobKind.Construction)) {
        workers.set(unitId, jobs.paramsOf(unitId)! as ConstructionJobParams);
    }
    return workers;
}

export const BuildingConstructionFeature: FeatureDefinition = {
    id: 'building-construction',
    dependencies: ['inventory', 'logistics', 'settler-tasks', 'recruit'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { demandLedger } = ctx.getFeature<DemandLedgerExports>('logistics');

        const constructionWorkerDemands = new ConstructionWorkerDemands(ctx.eventBus);
        const constructionSiteManager = new ConstructionSiteManager(
            ctx.eventBus,
            ctx.gameState.rng,
            inventoryManager,
            constructionWorkerDemands
        );

        const constructionSystem = new BuildingConstructionSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            executeCommand: ctx.executeCommand,
        });

        const residenceSpawner = new ResidenceSpawnerSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
        });
        constructionSystem.setResidenceSpawner(residenceSpawner);

        const constructionRequestSystem = new ConstructionRequestSystem(
            constructionSiteManager,
            demandLedger,
            ctx.eventBus
        );

        const constructionDemandSystem = createConstructionDemandSystem(
            ctx,
            constructionSiteManager,
            constructionWorkerDemands
        );
        registerConstructionExecutors(ctx.choreoSystem, constructionSiteManager, inventoryManager);

        constructionSystem.setTerrainContext({
            terrain: ctx.terrain,
            onTerrainModified: (reason, tile) =>
                ctx.eventBus.emit('terrain:modified', { reason, x: tile.x, y: tile.y }),
        });

        // Pile positions from XML game data (always loaded before a game is created).
        const pileRegistry = new BuildingPileRegistry(getGameDataLoader().getData());
        const pilePositionResolver = new PilePositionResolver(ctx.gameState, pileRegistry);

        // BuildingLifecycleHandler manages construction site registration,
        // inventory swaps on completion, and material delivery tracking.
        const buildingLifecycle = new BuildingLifecycleHandler({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            cleanupRegistry: ctx.cleanupRegistry,
            pilePositionResolver,
        });
        // Lifecycle must register before construction system so registerSite runs
        // before the building:placed handler that captures terrain data.
        buildingLifecycle.registerEvents();
        constructionSystem.registerEvents();
        // After constructionSystem / constructionRequestSystem: their building:removed and
        // construction:materialDelivered handlers run first.
        constructionDemandSystem.registerEvents();

        // Configure inventory manager with pile entity management deps
        inventoryManager.configure({
            executeCommand: ctx.executeCommand,
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
        });

        const spawnDeps = { state: ctx.gameState, terrain: ctx.terrain, eventBus: ctx.eventBus };

        const exports: BuildingConstructionExports = {
            constructionSiteManager,
            constructionSystem,
            constructionRequestSystem,
            residenceSpawner,
            pileRegistry,
            constructionWorkerDemands,
        };

        return {
            systems: [
                constructionSystem,
                residenceSpawner,
                constructionRequestSystem,
                { system: constructionDemandSystem, phase: TickPhase.ConstructionDemand },
            ],
            tickPhase: TickPhase.Construction,
            exports,
            persistence: [constructionSiteManager.persistentStore],
            commands: {
                spawn_building_units: cmd => executeSpawnBuildingUnits(spawnDeps, cmd as SpawnBuildingUnitsCommand),
            },
            onRestoreComplete() {
                // Completes finished sites first, so demands are rebuilt only for live sites.
                constructionSystem.rebuildAfterRestore();
                // Restored workers are rebound to their demands (with their tiles); their jobs
                // resume in settler-tasks' onRestoreResume. Nothing is assigned here.
                constructionWorkerDemands.rebuildFromSites(
                    constructionSiteManager
                        .getAllSiteIds()
                        .map(id => constructionSiteManager.getSiteOrThrow(id, 'rebuildFromSites')),
                    restoredConstructionWorkers(ctx)
                );
            },
            destroy: () => {
                buildingLifecycle.unregisterEvents();
                constructionRequestSystem.destroy();
                constructionDemandSystem.unregisterEvents();
            },
        };
    },
};

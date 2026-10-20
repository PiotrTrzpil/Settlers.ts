/**
 * ConstructionDemand Feature — wires ConstructionSiteDemandSystem and
 * construction choreo executors into the feature registry.
 *
 * Orchestrates "construction site needs workers" by creating demands,
 * finding candidates, and building choreo dispatch jobs.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { SettlerTaskExports } from '../settler-tasks';
import { SearchType, WorkHandlerType } from '../settler-tasks/types';
import type { RecruitExports } from '../recruit';
import type { BuildingConstructionExports } from './building-construction-feature';
import type { InventoryExports } from '../inventory';
import { ConstructionSiteDemandSystem } from './construction-site-demand';
import { registerConstructionExecutors } from './internal/construction-executors';
import { TickPhase } from '../../core/tick-phase';

export interface ConstructionDemandExports {
    constructionDemandSystem: ConstructionSiteDemandSystem;
}

export const ConstructionDemandFeature: FeatureDefinition = {
    id: 'construction-demand',
    dependencies: ['building-construction', 'inventory', 'settler-tasks', 'recruit'],

    create(ctx: FeatureContext) {
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { settlerTaskSystem, choreoSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { recruitSystem } = ctx.getFeature<RecruitExports>('recruit');

        const constructionDemandSystem = new ConstructionSiteDemandSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            siteManager: constructionSiteManager,
            findIdleSpecialist: (unitType, player, nearX, nearY) =>
                settlerTaskSystem.findIdleSpecialist(unitType, player, nearX, nearY),
            assignJob: (unitId, job, moveTo) => settlerTaskSystem.assignJob(unitId, job, moveTo),
            dispatchRecruitment: (unitType, player, opts) => recruitSystem.dispatchRecruitment(unitType, player, opts),
        });

        // Register DIG_TILE and BUILD_STEP executors on shared ChoreoSystem
        registerConstructionExecutors(choreoSystem, constructionSiteManager, inventoryManager);

        // Register no-op work handlers for CONSTRUCTION / CONSTRUCTION_DIG.
        // Idle builders/diggers are dispatched by the demand system, not by
        // the idle-scan work handler path — but a handler must exist to
        // suppress "No work handler registered" warnings.
        const noopHandler = {
            type: WorkHandlerType.NULL as const,
            shouldWaitForWork: true,
        };
        settlerTaskSystem.registerWorkHandler(SearchType.CONSTRUCTION, noopHandler);
        settlerTaskSystem.registerWorkHandler(SearchType.CONSTRUCTION_DIG, noopHandler);

        // Wire site lifecycle → demand system (direct listener, not the event bus)
        constructionSiteManager.setListener(constructionDemandSystem);

        ctx.eventBus.on('construction:materialDelivered', ({ buildingId }) => {
            constructionDemandSystem.onMaterialsDelivered(buildingId);
        });

        constructionDemandSystem.registerEvents();

        return {
            systems: [constructionDemandSystem],
            tickPhase: TickPhase.Demand,
            exports: {
                constructionDemandSystem,
            } satisfies ConstructionDemandExports,
            persistence: 'none',
            // Runs after building-construction's onRestoreComplete (dependency order),
            // so restored sites already have terrain rebuilt and finished sites removed.
            onRestoreComplete() {
                constructionDemandSystem.rebuildFromSites();
            },
            destroy: () => {
                constructionDemandSystem.unregisterEvents();
            },
        };
    },
};

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
            type: WorkHandlerType.ENTITY as const,
            findTarget: () => null,
            canWork: () => false,
            onWorkTick: () => true,
        };
        settlerTaskSystem.registerWorkHandler(SearchType.CONSTRUCTION, noopHandler);
        settlerTaskSystem.registerWorkHandler(SearchType.CONSTRUCTION_DIG, noopHandler);

        // Wire site lifecycle → demand system
        ctx.eventBus.on('construction:workerNeeded', ({ buildingId, role }) => {
            if (role === 'digger') {
                constructionDemandSystem.onSiteRegistered(buildingId);
            } else {
                constructionDemandSystem.onMaterialsDelivered(buildingId);
            }
        });

        ctx.eventBus.on('construction:materialDelivered', ({ buildingId }) => {
            constructionDemandSystem.onMaterialsDelivered(buildingId);
        });

        constructionDemandSystem.registerEvents();

        return {
            systems: [constructionDemandSystem],
            exports: {
                constructionDemandSystem,
            } satisfies ConstructionDemandExports,
            persistence: 'none',
            destroy: () => {
                constructionDemandSystem.unregisterEvents();
            },
        };
    },
};

/**
 * BuildingDemand Feature — wires BuildingDemandSystem into the feature registry and registers the
 * `WorkplaceDispatch` job kind. Orchestrates "building needs a worker" by selecting candidates and
 * dispatching owned WorkplaceDispatch jobs (docs/designs/job-ownership.md).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { SettlerTaskExports } from '../settler-tasks';
import type { RecruitExports } from '../recruit';
import type { BuildingConstructionExports } from '../building-construction';
import { BuildingDemandSystem } from './building-demand-system';
import { createWorkplaceDispatchKind } from './workplace-dispatch-kind';
import { BuildingType } from '../../entity';
import { BUILDING_SPAWN_ON_COMPLETE } from '../building-construction/spawn-units';
import { forEachCompletedBuilding } from '../restore-utils';
import { TickPhase } from '../../core/tick-phase';

export interface BuildingDemandExports {
    buildingDemandSystem: BuildingDemandSystem;
}

export const BuildingDemandFeature: FeatureDefinition = {
    id: 'building-demand',
    dependencies: ['settler-tasks', 'recruit', 'building-construction'],

    create(ctx: FeatureContext) {
        const { jobs, workerAssignments } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { recruitSystem, recruitSegments } = ctx.getFeature<RecruitExports>('recruit');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');

        const buildingDemandSystem = new BuildingDemandSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            jobs,
            findIdleSpecialist: (unitType, player, nearX, nearY) =>
                workerAssignments.findIdleSpecialist(unitType, player, nearX, nearY),
            assignWorkerToBuilding: (settlerId, buildingId) => workerAssignments.assignWorker(settlerId, buildingId),
            dispatchRecruitment: (unitType, player, opts) => recruitSystem.dispatchRecruitment(unitType, player, opts),
            getOccupantCount: buildingId => workerAssignments.getOccupantCount(buildingId),
        });

        jobs.registerKind(
            createWorkplaceDispatchKind({
                gameState: ctx.gameState,
                terrain: ctx.terrain,
                segments: recruitSegments,
                owner: buildingDemandSystem,
            })
        );
        buildingDemandSystem.registerEvents();

        return {
            systems: [buildingDemandSystem],
            tickPhase: TickPhase.Demand,
            exports: {
                buildingDemandSystem,
            } satisfies BuildingDemandExports,
            persistence: 'none',
            // Dispatch state is persisted as WorkplaceDispatch commitments (settler-tasks); demands are derived.
            onRestoreComplete() {
                // Committed demands first (from the restored jobs, which resume in onRestoreResume) — so the
                // replay below does not dispatch a second unit to those buildings.
                buildingDemandSystem.restoreCommittedDemands();
                forEachCompletedBuilding(ctx.gameState, constructionSiteManager, e => {
                    const bt = e.subType as BuildingType;
                    if (!BUILDING_SPAWN_ON_COMPLETE[bt]) {
                        buildingDemandSystem.addDemandFromBuilding(e.id, bt, e.race);
                    }
                });
            },
            destroy: () => {
                buildingDemandSystem.unregisterEvents();
            },
        };
    },
};

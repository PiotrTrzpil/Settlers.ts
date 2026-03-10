/**
 * BuildingDemand Feature — wires BuildingDemandSystem into the
 * feature registry. Orchestrates "building needs a worker" by
 * selecting candidates and building choreo dispatch jobs.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { SettlerTaskExports } from '../settler-tasks';
import type { RecruitExports } from '../recruit';
import { BuildingDemandSystem } from './building-demand-system';
import type { SettlerLocationExports } from '../settler-location/types';
import { ChoreoTaskType } from '@/game/systems/choreo';
import { createEnterBuildingExecutor } from '../settler-tasks/internal/dispatch-executors';

export interface BuildingDemandExports {
    buildingDemandSystem: BuildingDemandSystem;
}

export const BuildingDemandFeature: FeatureDefinition = {
    id: 'building-demand',
    dependencies: [
        'settler-tasks',
        'recruit',
        'settler-location',
    ],

    create(ctx: FeatureContext) {
        const {
            settlerTaskSystem, choreoSystem,
        } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');
        const { recruitSystem } = ctx.getFeature<RecruitExports>('recruit');

        const buildingDemandSystem = new BuildingDemandSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            findIdleSpecialist: (unitType, player, nearX, nearY) =>
                settlerTaskSystem.findIdleSpecialist(
                    unitType, player, nearX, nearY,
                ),
            assignJob: (unitId, job, moveTo) =>
                settlerTaskSystem.assignJob(unitId, job, moveTo),
            assignWorkerToBuilding: (settlerId, buildingId) =>
                settlerTaskSystem.assignWorkerToBuilding(
                    settlerId, buildingId,
                ),
            dispatchRecruitment: (unitType, player, opts) =>
                recruitSystem.dispatchRecruitment(unitType, player, opts),
        });

        // Register ENTER_BUILDING executor on shared ChoreoSystem
        choreoSystem.register(ChoreoTaskType.ENTER_BUILDING, createEnterBuildingExecutor(locationManager));

        buildingDemandSystem.registerEvents();

        return {
            systems: [buildingDemandSystem],
            exports: {
                buildingDemandSystem,
            } satisfies BuildingDemandExports,
            persistence: 'none',
            destroy: () => {
                buildingDemandSystem.unregisterEvents();
            },
        };
    },
};

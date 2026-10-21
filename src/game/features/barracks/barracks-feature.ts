/**
 * Barracks Feature — wraps BarracksTrainingManager as a self-registering feature.
 *
 * Handles its own building lifecycle:
 * - building:completed for Barrack buildings -> initBarracks
 * - entity:removed -> removeBarracks (cancels its training jobs)
 *
 * Owns the `Barracks` job kind (training carriers) and registers the barracks' recruit charge
 * (recipe inputs, input side) for its TRANSFORM_RECRUIT_BUILDING nodes.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { ProductionControlExports } from '../production-control';
import type { BuildingConstructionExports } from '../building-construction';
import type { RecruitExports } from '../recruit';
import type { SettlerTaskExports } from '../settler-tasks';
import { BarracksTrainingManager } from './barracks-training-manager';
import { createBarracksJobKind, createBarracksRecruitCharge } from './barracks-job-kind';
import { BuildingType } from '../../buildings/building-type';
import { forEachCompletedBuilding } from '../restore-utils';
import { TickPhase } from '../../core/tick-phase';

export interface BarracksExports {
    barracksTrainingManager: BarracksTrainingManager;
}

export const BarracksFeature: FeatureDefinition = {
    id: 'barracks',
    dependencies: ['production-control', 'building-construction', 'recruit', 'settler-tasks'],

    create(ctx: FeatureContext) {
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { recruitSystem, recruitSegments } = ctx.getFeature<RecruitExports>('recruit');
        const { jobs } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const barracksTrainingManager = new BarracksTrainingManager({
            gameState: ctx.gameState,
            productionControlManager,
            eventBus: ctx.eventBus,
            recruitSystem,
            jobs,
        });

        recruitSegments.registerBuildingCharge(BuildingType.Barrack, createBarracksRecruitCharge(ctx.gameState));
        jobs.registerKind(
            createBarracksJobKind({
                gameState: ctx.gameState,
                segments: recruitSegments,
                manager: barracksTrainingManager,
            })
        );

        barracksTrainingManager.registerEvents();

        // Handle barracks lifecycle events
        ctx.on('building:completed', ({ buildingId, buildingType, race }) => {
            if (buildingType === BuildingType.Barrack) {
                barracksTrainingManager.initBarracks(buildingId, race);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            barracksTrainingManager.removeBarracks(entityId);
        });

        return {
            systems: [barracksTrainingManager],
            tickPhase: TickPhase.Military,
            exports: { barracksTrainingManager } satisfies BarracksExports,
            persistence: [],
            destroy: () => {
                barracksTrainingManager.unregisterEvents();
            },
            onRestoreComplete() {
                forEachCompletedBuilding(ctx.gameState, constructionSiteManager, e => {
                    if (e.subType === BuildingType.Barrack) {
                        barracksTrainingManager.initBarracks(e.id, e.race);
                    }
                });
                // Barracks jobs resume by themselves in onRestoreResume — only the training state is rebuilt.
                barracksTrainingManager.rebuildFromCommitments();
            },
        };
    },
};

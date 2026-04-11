/**
 * Barracks Feature — wraps BarracksTrainingManager as a self-registering feature.
 *
 * Handles its own building lifecycle:
 * - building:completed for Barrack buildings -> initBarracks
 * - entity:removed -> removeBarracks
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { ProductionControlExports } from '../production-control';
import type { BuildingConstructionExports } from '../building-construction';
import type { RecruitExports } from '../recruit';
import { BarracksTrainingManager } from './barracks-training-manager';
import { BuildingType } from '../../buildings/building-type';
import { forEachCompletedBuilding } from '../restore-utils';

export interface BarracksExports {
    barracksTrainingManager: BarracksTrainingManager;
}

export const BarracksFeature: FeatureDefinition = {
    id: 'barracks',
    dependencies: ['production-control', 'building-construction', 'recruit'],

    create(ctx: FeatureContext) {
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { recruitSystem } = ctx.getFeature<RecruitExports>('recruit');

        const barracksTrainingManager = new BarracksTrainingManager({
            gameState: ctx.gameState,
            productionControlManager,
            eventBus: ctx.eventBus,
            recruitSystem,
        });

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
            systemGroup: 'Military',
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
            },
        };
    },
};

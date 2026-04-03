/**
 * Barracks Feature — wraps BarracksTrainingManager as a self-registering feature.
 *
 * Handles its own building lifecycle:
 * - building:completed for Barrack buildings -> initBarracks
 * - entity:removed -> removeBarracks
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { CarrierFeatureExports } from '../carriers';
import type { ProductionControlExports } from '../production-control';
import type { SettlerTaskExports } from '../settler-tasks';
import type { BuildingConstructionExports } from '../building-construction';
import { BarracksTrainingManager } from './barracks-training-manager';
import { BuildingType } from '../../buildings/building-type';
import { EntityType } from '../../entity';

export interface BarracksExports {
    barracksTrainingManager: BarracksTrainingManager;
}

export const BarracksFeature: FeatureDefinition = {
    id: 'barracks',
    dependencies: ['inventory', 'carriers', 'settler-tasks', 'production-control', 'building-construction'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { carrierRegistry, idleCarrierPool } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');

        const barracksTrainingManager = new BarracksTrainingManager({
            gameState: ctx.gameState,
            inventoryManager,
            carrierRegistry,
            idleCarrierPool,
            settlerTaskSystem,
            productionControlManager,
            eventBus: ctx.eventBus,
            unitReservation: ctx.unitReservation,
        });

        // Wire barracks training manager back to settler-tasks feature (lazy dependency)
        const settlerTaskExports = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        settlerTaskExports.setBarracksTrainingManager(() => barracksTrainingManager);

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
            onRestoreComplete() {
                for (const e of ctx.gameState.entities) {
                    if (e.type !== EntityType.Building) {
                        continue;
                    }
                    if (constructionSiteManager.hasSite(e.id)) {
                        continue;
                    }
                    if (e.subType === BuildingType.Barrack) {
                        barracksTrainingManager.initBarracks(e.id, e.race);
                    }
                }
            },
        };
    },
};

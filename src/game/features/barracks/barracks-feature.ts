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
import type { ProductionControlExports } from '../production-control/production-control-feature';
import type { SettlerTaskExports } from '../settler-tasks/settler-tasks-feature';
import type { LogisticsDispatcherExports } from '../logistics/logistics-dispatcher-feature';
import { BarracksTrainingManager } from './barracks-training-manager';
import { BuildingType } from '../../buildings/building-type';

export interface BarracksExports {
    barracksTrainingManager: BarracksTrainingManager;
}

export const BarracksFeature: FeatureDefinition = {
    id: 'barracks',
    dependencies: ['inventory', 'carriers', 'settler-tasks', 'production-control', 'logistics-dispatcher'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { carrierRegistry } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { logisticsDispatcher } = ctx.getFeature<LogisticsDispatcherExports>('logistics-dispatcher');

        const barracksTrainingManager = new BarracksTrainingManager({
            gameState: ctx.gameState,
            inventoryManager,
            carrierRegistry,
            settlerTaskSystem,
            productionControlManager,
            eventBus: ctx.eventBus,
            isCarrierBusy: (carrierId: number) => logisticsDispatcher.activeJobs.has(carrierId),
        });

        // Wire barracks training manager back to settler-tasks feature (lazy dependency)
        const settlerTaskExports = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        settlerTaskExports.setBarracksTrainingManager(() => barracksTrainingManager);

        // Handle barracks lifecycle events
        ctx.on('building:completed', ({ entityId, buildingType, race }) => {
            if (buildingType === BuildingType.Barrack) {
                barracksTrainingManager.initBarracks(entityId, race);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            barracksTrainingManager.removeBarracks(entityId);
        });

        return {
            systems: [barracksTrainingManager],
            systemGroup: 'Military',
            exports: { barracksTrainingManager } satisfies BarracksExports,
        };
    },
};

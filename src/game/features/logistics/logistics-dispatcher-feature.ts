/**
 * LogisticsDispatcher Feature — wraps LogisticsDispatcher as a self-registering feature.
 *
 * Connects resource requests to carriers for material delivery.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { BuildingConstructionExports } from '../building-construction/building-construction-feature';
import type { RequestManagerExports } from './request-manager-feature';
import type { InventoryExports } from '../inventory';
import type { SettlerTaskSystem } from '../settler-tasks';
import { LogisticsDispatcher } from './logistics-dispatcher';

interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
}

export interface LogisticsDispatcherExports {
    logisticsDispatcher: LogisticsDispatcher;
}

export const LogisticsDispatcherFeature: FeatureDefinition = {
    id: 'logistics-dispatcher',
    dependencies: ['carriers', 'settler-tasks', 'logistics', 'inventory', 'building-construction'],

    create(ctx: FeatureContext) {
        const { carrierRegistry, idleCarrierPool, setIsTransportBusy } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { requestManager } = ctx.getFeature<RequestManagerExports>('logistics');
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');

        const logisticsDispatcher = new LogisticsDispatcher({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
            idleCarrierPool,
            jobAssigner: settlerTaskSystem,
            positionResolver: settlerTaskSystem.getPositionResolver(),
            requestManager,
            inventoryManager,
        });
        logisticsDispatcher.registerEvents(ctx.eventBus, ctx.cleanupRegistry);

        // Wire the transport busy check into the idle carrier pool (late binding)
        setIsTransportBusy((carrierId: number) => logisticsDispatcher.activeJobs.has(carrierId));

        // Wire transport job ops back to settler tasks (late binding — dispatcher depends on settler tasks)
        settlerTaskSystem.setTransportJobOps(logisticsDispatcher.createTransportJobOps());

        // Wire in-flight tracker to construction request system (late binding — avoids circular dep)
        const { constructionRequestSystem } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        constructionRequestSystem.setInFlightTracker(logisticsDispatcher.inFlightTracker);

        return {
            systems: [logisticsDispatcher],
            systemGroup: 'Logistics',
            exports: { logisticsDispatcher } satisfies LogisticsDispatcherExports,
        };
    },
};

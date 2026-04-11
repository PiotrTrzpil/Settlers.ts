/**
 * LogisticsDispatcher Feature — wraps LogisticsDispatcher as a self-registering feature.
 *
 * Connects demand queue to carriers for material delivery.
 * Registers transport choreography executors on ChoreoSystem (moved from settler-tasks).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { DemandQueueExports } from './demand-queue-feature';
import type { InventoryExports } from '../inventory';
import type { MaterialTransferExports } from '../material-transfer/material-transfer-feature';
import type { BuildingConstructionExports } from '../building-construction';
import type { TaskDispatcher } from '../settler-tasks';
import type { SettlerTaskExports } from '../settler-tasks';
import type { MovementContext } from '../settler-tasks';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { createLogger } from '@/utilities/logger';
import { LogisticsDispatcher } from './logistics-dispatcher';
import { registerTransportExecutors, type TransportExecutorContext } from './internal/transport-executor-context';

export interface LogisticsDispatcherExports {
    logisticsDispatcher: LogisticsDispatcher;
}

export const LogisticsDispatcherFeature: FeatureDefinition = {
    id: 'logistics-dispatcher',
    dependencies: ['carriers', 'settler-tasks', 'logistics', 'inventory', 'building-construction', 'material-transfer'],

    create(ctx: FeatureContext) {
        const { carrierRegistry, idleCarrierPool } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const settlerTaskExports = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { settlerTaskSystem, choreoSystem } = settlerTaskExports;
        const taskDispatcher = settlerTaskSystem as unknown as TaskDispatcher;
        const { demandQueue, jobStore } = ctx.getFeature<DemandQueueExports>('logistics');
        const { inventoryManager, storageFilterManager } = ctx.getFeature<InventoryExports>('inventory');
        const { materialTransfer } = ctx.getFeature<MaterialTransferExports>('material-transfer');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');

        const positionResolver = settlerTaskSystem.getPositionResolver();

        const handlerErrorLogger = new ThrottledLogger(createLogger('LogisticsTransportExecutors'), 2000);

        const movementCtx: MovementContext = {
            gameState: ctx.gameState,
            buildingPositionResolver: positionResolver,
            getWorkerHomeBuilding: () => null,
            handlerErrorLogger,
        };

        const transportCtx: TransportExecutorContext = {
            inventoryManager,
            materialTransfer,
            eventBus: ctx.eventBus,
            constructionSiteManager,
        };

        registerTransportExecutors(choreoSystem, movementCtx, transportCtx);

        const logisticsDispatcher = new LogisticsDispatcher({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
            idleCarrierPool,
            jobAssigner: taskDispatcher,
            positionResolver,
            demandQueue,
            jobStore,
            inventoryManager,
            storageFilterManager,
        });
        logisticsDispatcher.registerEvents(ctx.eventBus, ctx.cleanupRegistry);

        return {
            systems: [logisticsDispatcher],
            systemGroup: 'Logistics',
            persistence: [],
            exports: { logisticsDispatcher } satisfies LogisticsDispatcherExports,
            onRestoreComplete() {
                // Transport jobs are transient — not persisted. Reconstruct from entity state:
                // - Carriers with entity.carrying → rebuild delivery-only choreo from slot reservation
                // - Carriers with jobId but no carrying → clear jobId, release reservation
                logisticsDispatcher.rebuildFromEntities();
            },
        };
    },
};

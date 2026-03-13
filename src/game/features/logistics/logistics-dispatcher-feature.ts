/**
 * LogisticsDispatcher Feature — wraps LogisticsDispatcher as a self-registering feature.
 *
 * Connects demand queue to carriers for material delivery.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { DemandQueueExports } from './demand-queue-feature';
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
        const { carrierRegistry, idleCarrierPool, setIsTransportBusy } =
            ctx.getFeature<CarrierFeatureExports>('carriers');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { demandQueue, jobStore } = ctx.getFeature<DemandQueueExports>('logistics');
        const { inventoryManager, storageFilterManager } = ctx.getFeature<InventoryExports>('inventory');

        const logisticsDispatcher = new LogisticsDispatcher({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
            idleCarrierPool,
            jobAssigner: settlerTaskSystem,
            positionResolver: settlerTaskSystem.getPositionResolver(),
            demandQueue,
            jobStore,
            inventoryManager,
            storageFilterManager,
        });
        logisticsDispatcher.registerEvents(ctx.eventBus, ctx.cleanupRegistry);

        // Wire the transport busy check into the idle carrier pool (late binding)
        setIsTransportBusy((carrierId: number) => logisticsDispatcher.jobStore.jobs.has(carrierId));

        // Wire transport job ops back to settler tasks (late binding — dispatcher depends on settler tasks)
        settlerTaskSystem.setTransportJobOps(logisticsDispatcher.createTransportJobOps());

        return {
            systems: [logisticsDispatcher],
            systemGroup: 'Logistics',
            persistence: [jobStore.jobs, jobStore.nextJobIdStore],
            exports: { logisticsDispatcher } satisfies LogisticsDispatcherExports,
            onRestoreComplete() {
                // Carrier choreo tasks are transient — after keyframe restore, jobs in
                // Reserved phase have carriers that will never start pickup. Cancel them
                // so demands re-enter the queue and get re-matched on the next tick.
                logisticsDispatcher.cancelReservedJobs();
            },
        };
    },
};

/**
 * LogisticsDispatcher Feature — wraps LogisticsDispatcher as a self-registering feature.
 *
 * Connects demand queue to carriers for material delivery.
 * Registers the TRANSPORT_* choreography executors on the kernel ChoreoSystem and the
 * Transport JobKind handler (the owner of carrier transport jobs) with the job runtime.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { DemandLedgerExports } from './demand-ledger-feature';
import type { InventoryExports } from '../inventory';
import type { MaterialTransferExports } from '../material-transfer/material-transfer-feature';
import type { BuildingConstructionExports } from '../building-construction';
import type { SettlerTaskExports } from '../settler-tasks';
import type { MovementContext } from '../settler-tasks';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { createLogger } from '@/utilities/logger';
import { LogisticsDispatcher } from './logistics-dispatcher';
import { registerTransportExecutors, type TransportExecutorContext } from './internal/transport-executor-context';
import { TransportJobKind } from './transport-job-kind';
import type { TransportJobDeps } from './transport-job-service';
import { TickPhase } from '../../core/tick-phase';

export interface LogisticsDispatcherExports {
    logisticsDispatcher: LogisticsDispatcher;
}

export const LogisticsDispatcherFeature: FeatureDefinition = {
    id: 'logistics-dispatcher',
    dependencies: ['carriers', 'settler-tasks', 'logistics', 'inventory', 'building-construction', 'material-transfer'],

    create(ctx: FeatureContext) {
        const { idleCarrierPool } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { settlerTaskSystem, jobs } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { demandLedger, jobStore } = ctx.getFeature<DemandLedgerExports>('logistics');
        const { inventoryManager, storageFilterManager } = ctx.getFeature<InventoryExports>('inventory');
        const { materialTransfer } = ctx.getFeature<MaterialTransferExports>('material-transfer');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');

        const handlerErrorLogger = new ThrottledLogger(createLogger('LogisticsTransportExecutors'), 2000);

        const movementCtx: MovementContext = {
            gameState: ctx.gameState,
            buildingPositionResolver: settlerTaskSystem.getPositionResolver(),
            handlerErrorLogger,
        };

        const transportJobDeps: TransportJobDeps = {
            jobStore,
            demandLedger,
            eventBus: ctx.eventBus,
            inventoryManager,
            jobs,
        };

        const transportCtx: TransportExecutorContext = {
            inventoryManager,
            materialTransfer,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            jobStore,
            transportJobDeps,
        };

        registerTransportExecutors(ctx.choreoSystem, movementCtx, transportCtx);

        const transportJobs = new TransportJobKind({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            inventoryManager,
            jobStore,
            transportJobDeps,
            jobs,
        });
        jobs.registerKind(transportJobs);

        const logisticsDispatcher = new LogisticsDispatcher({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            idleCarrierPool,
            transportJobs,
            unitCommitments: jobs.commitments,
            transportJobDeps,
            demandLedger,
            jobStore,
            inventoryManager,
            storageFilterManager,
        });
        logisticsDispatcher.registerEvents(ctx.eventBus, ctx.cleanupRegistry);

        return {
            systems: [logisticsDispatcher],
            tickPhase: TickPhase.Logistics,
            persistence: [],
            exports: { logisticsDispatcher } satisfies LogisticsDispatcherExports,
            onRestoreComplete() {
                // Records are persisted; carrier jobs resume by themselves (onRestoreResume).
                // Drop queued follow-ups and records no carrier runs any more.
                logisticsDispatcher.restoreJobs();
            },
        };
    },
};

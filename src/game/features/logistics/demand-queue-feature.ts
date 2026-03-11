/**
 * Demand Queue Feature — self-registering feature module for the stateless demand queue
 * and the transport job store (single source of truth for active transport jobs).
 *
 * Replaces RequestManagerFeature. Creates the DemandQueue, TransportJobStore, and injects
 * the EventBus. Uses id='logistics' so downstream features access these via ctx.getFeature('logistics').
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { DemandQueue } from './demand-queue';
import { TransportJobStore } from './transport-job-store';

export interface DemandQueueExports {
    demandQueue: DemandQueue;
    jobStore: TransportJobStore;
}

export const DemandQueueFeature: FeatureDefinition = {
    id: 'logistics',
    dependencies: [],

    create(ctx: FeatureContext) {
        const demandQueue = new DemandQueue(ctx.eventBus);
        const jobStore = new TransportJobStore();

        return {
            exports: { demandQueue, jobStore } satisfies DemandQueueExports,
            // DemandQueue is NOT persisted — demands are recomputed from inventory state on first tick
            // TransportJobStore persistence is handled by LogisticsDispatcherFeature
            persistence: 'none',
        };
    },
};

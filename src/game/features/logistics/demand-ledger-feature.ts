/**
 * Demand Ledger Feature — self-registering feature module for the declarative
 * demand ledger and the transport job store (single source of truth for
 * material in motion).
 *
 * Creates the DemandLedger and TransportJobStore. Uses id='logistics' so
 * downstream features access these via ctx.getFeature('logistics').
 *
 * Persistence: transport job records are persisted directly (they are flat);
 * choreographies are rebuilt from them on restore (LogisticsDispatcher).
 * The ledger is NOT persisted — standing orders are re-seeded from world
 * state on first tick by the scanner systems.
 */

import type { FeatureDefinition } from '../feature';
import { DemandLedger } from './demand-ledger';
import { TransportJobStore } from './transport-job-store';

export interface DemandLedgerExports {
    demandLedger: DemandLedger;
    jobStore: TransportJobStore;
}

export const DemandLedgerFeature: FeatureDefinition = {
    id: 'logistics',
    dependencies: [],

    create() {
        const demandLedger = new DemandLedger();
        const jobStore = new TransportJobStore();

        return {
            exports: { demandLedger, jobStore } satisfies DemandLedgerExports,
            persistence: [jobStore.jobs],
        };
    },
};

/**
 * Transport executor context — dependencies for TRANSPORT_* choreography executors.
 */

import type { ChoreoSystem } from '../../../systems/choreo';
import { ChoreoTaskType } from '../../../systems/choreo';
import type { EventBus } from '../../../event-bus';
import type { BuildingInventoryManager } from '../../inventory';
import type { MaterialTransfer } from '../../material-transfer';
import type { ConstructionSiteManager } from '../../building-construction/construction-site-manager';
import type { MovementContext } from '../../settler-tasks';
import type { TransportJobStore } from '../transport-job-store';
import type { TransportJobDeps } from '../transport-job-service';

import {
    executeTransportGoToSource,
    executeTransportGoToDest,
    executeTransportPickup,
    executeTransportDeliver,
    executeTransportStandUp,
} from './transport-executors';

/**
 * Context for inventory-phase transport executors (TRANSPORT_PICKUP, TRANSPORT_DELIVER).
 * Includes job store + deps so lifecycle is pure lookups (no per-job ops closures).
 */
export interface TransportExecutorContext {
    inventoryManager: BuildingInventoryManager;
    materialTransfer: MaterialTransfer;
    eventBus: EventBus;
    constructionSiteManager: ConstructionSiteManager;
    jobStore: TransportJobStore;
    transportJobDeps: TransportJobDeps;
}

/**
 * Register all TRANSPORT_* choreography executors on the given ChoreoSystem.
 */
export function registerTransportExecutors(
    choreoSystem: ChoreoSystem,
    movementCtx: MovementContext,
    transportCtx: TransportExecutorContext
): void {
    choreoSystem.register(ChoreoTaskType.TRANSPORT_GO_TO_SOURCE, (s, j, n, dt) =>
        executeTransportGoToSource(s, j, n, dt, movementCtx)
    );
    choreoSystem.register(ChoreoTaskType.TRANSPORT_GO_TO_DEST, (s, j, n, dt) =>
        executeTransportGoToDest(s, j, n, dt, movementCtx)
    );
    choreoSystem.register(ChoreoTaskType.TRANSPORT_PICKUP, (s, j, n, dt) =>
        executeTransportPickup(s, j, n, dt, transportCtx)
    );
    choreoSystem.register(ChoreoTaskType.TRANSPORT_DELIVER, (s, j, n, dt) =>
        executeTransportDeliver(s, j, n, dt, transportCtx)
    );
    choreoSystem.register(ChoreoTaskType.TRANSPORT_STAND_UP, (s, j, n, dt) => executeTransportStandUp(s, j, n, dt));
}

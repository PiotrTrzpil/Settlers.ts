/**
 * Transport executor context — minimal context type for carrier transport executors.
 *
 * Defines the dependencies needed by TRANSPORT_PICKUP and TRANSPORT_DELIVER executors,
 * and exports the registration function that wires all 4 TRANSPORT_* task types onto
 * a ChoreoSystem instance.
 */

import type { ChoreoSystem } from '../../../systems/choreo';
import { ChoreoTaskType } from '../../../systems/choreo';
import type { EventBus } from '../../../event-bus';
import type { BuildingInventoryManager } from '../../inventory';
import type { MaterialTransfer } from '../../material-transfer';
import type { ConstructionSiteManager } from '../../building-construction/construction-site-manager';
import type { MovementContext } from '../../settler-tasks/choreo-types';

import {
    executeTransportGoToSource,
    executeTransportGoToDest,
    executeTransportPickup,
    executeTransportDeliver,
} from './transport-executors';

// ─────────────────────────────────────────────────────────────
// TransportExecutorContext
// ─────────────────────────────────────────────────────────────

/**
 * Minimal context for inventory-phase transport executors (TRANSPORT_PICKUP, TRANSPORT_DELIVER).
 *
 * Movement-phase executors (TRANSPORT_GO_TO_SOURCE, TRANSPORT_GO_TO_DEST) use
 * MovementContext from settler-tasks.
 */
export interface TransportExecutorContext {
    inventoryManager: BuildingInventoryManager;
    materialTransfer: MaterialTransfer;
    eventBus: EventBus;
    constructionSiteManager: ConstructionSiteManager;
}

// ─────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────

/**
 * Register all 4 TRANSPORT_* choreography executors on the given ChoreoSystem.
 *
 * Call this from LogisticsDispatcherFeature.create() after building the contexts.
 * Movement executors (GO_TO_SOURCE/DEST) capture movementCtx; inventory executors
 * (PICKUP/DELIVER) capture transportCtx.
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
}

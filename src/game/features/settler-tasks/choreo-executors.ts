/**
 * Choreography executor registration — registers all core executors on a ChoreoSystem.
 *
 * Call registerCoreExecutors() once during WorkerTaskExecutor construction to wire
 * all built-in task types. Domain features (e.g. recruit) register their own
 * task types independently on the same ChoreoSystem instance.
 */

import { ChoreoSystem, ChoreoTaskType } from '../../systems/choreo';
import type { MovementContext, WorkContext, InventoryExecutorContext, ControlContext } from './choreo-types';

// Movement
import {
    executeGoToTarget,
    executeGoToTargetRoughly,
    executeGoToPos,
    executeGoToPosRoughly,
    executeGoHome,
    executeGoToSourcePile,
    executeGoToDestinationPile,
    executeSearch,
    executeGoVirtual,
} from './internal/movement-executors';

// Work
import {
    executeWork,
    executeWorkOnEntity,
    executeWorkVirtual,
    executeWorkOnEntityVirtual,
    executeProduceVirtual,
} from './internal/work-executors';

// Inventory
import {
    executeGetGood,
    executePutGood,
    executeResourceGathering,
    executeLoadGood,
} from './internal/inventory-executors';

// Control
import {
    executeWait,
    executeCheckin,
    executeChangeJob,
    executeChangeTypeAtBarracks,
    executeHealEntity,
    executeAttackReaction,
} from './internal/control-executors';

export { ChoreoSystem };

// ─────────────────────────────────────────────────────────────
// Core executor registration
// ─────────────────────────────────────────────────────────────

/**
 * Register all core choreography executors on a ChoreoSystem instance.
 *
 * Executors are closures that capture their context objects by reference.
 * Contexts are mutated in-place per tick (zero allocation) — mutations are
 * visible to already-registered closures.
 *
 * TRANSFORM_RECRUIT and TRANSFORM_DIRECT are NOT registered here.
 * The recruit feature registers those on the same ChoreoSystem after creation.
 */
export function registerCoreExecutors(
    choreoSystem: ChoreoSystem,
    movCtx: MovementContext,
    workCtx: WorkContext,
    invCtx: InventoryExecutorContext,
    ctrlCtx: ControlContext
): void {
    // ── Movement ──────────────────────────────────────────────
    choreoSystem.register(ChoreoTaskType.GO_TO_TARGET, (s, j, n, dt) => executeGoToTarget(s, j, n, dt, movCtx));
    choreoSystem.register(ChoreoTaskType.GO_TO_TARGET_ROUGHLY, (s, j, n, dt) =>
        executeGoToTargetRoughly(s, j, n, dt, movCtx)
    );
    choreoSystem.register(ChoreoTaskType.GO_TO_POS, (s, j, n, dt) => executeGoToPos(s, j, n, dt, movCtx));
    choreoSystem.register(ChoreoTaskType.GO_TO_POS_ROUGHLY, (s, j, n, dt) =>
        executeGoToPosRoughly(s, j, n, dt, movCtx)
    );
    choreoSystem.register(ChoreoTaskType.GO_TO_SOURCE_PILE, (s, j, n, dt) =>
        executeGoToSourcePile(s, j, n, dt, movCtx)
    );
    choreoSystem.register(ChoreoTaskType.GO_TO_DESTINATION_PILE, (s, j, n, dt) =>
        executeGoToDestinationPile(s, j, n, dt, movCtx)
    );
    choreoSystem.register(ChoreoTaskType.GO_HOME, (s, j, n, dt) => executeGoHome(s, j, n, dt, movCtx));
    choreoSystem.register(ChoreoTaskType.GO_VIRTUAL, (s, j, n, dt) => executeGoVirtual(s, j, n, dt, movCtx));
    choreoSystem.register(ChoreoTaskType.SEARCH, (s, j, n, dt) => executeSearch(s, j, n, dt, movCtx));

    // ── Work ──────────────────────────────────────────────────
    choreoSystem.register(ChoreoTaskType.WORK, (s, j, n, dt) => executeWork(s, j, n, dt, workCtx));
    choreoSystem.register(ChoreoTaskType.WORK_ON_ENTITY, (s, j, n, dt) => executeWorkOnEntity(s, j, n, dt, workCtx));
    choreoSystem.register(ChoreoTaskType.WORK_VIRTUAL, (s, j, n, dt) => executeWorkVirtual(s, j, n, dt, workCtx));
    choreoSystem.register(ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL, (s, j, n, dt) =>
        executeWorkOnEntityVirtual(s, j, n, dt, workCtx)
    );
    choreoSystem.register(ChoreoTaskType.PRODUCE_VIRTUAL, (s, j, n, dt) => executeProduceVirtual(s, j, n, dt, workCtx));
    choreoSystem.register(ChoreoTaskType.PLANT, (s, j, n, dt) => executeWork(s, j, n, dt, workCtx));

    // ── Inventory ─────────────────────────────────────────────
    choreoSystem.register(ChoreoTaskType.GET_GOOD, (s, j, n, dt) => executeGetGood(s, j, n, dt, invCtx));
    choreoSystem.register(ChoreoTaskType.GET_GOOD_VIRTUAL, (s, j, n, dt) => {
        j.visible = false;
        return executeGetGood(s, j, n, dt, invCtx);
    });
    choreoSystem.register(ChoreoTaskType.PUT_GOOD, (s, j, n, dt) => executePutGood(s, j, n, dt, invCtx));
    choreoSystem.register(ChoreoTaskType.PUT_GOOD_VIRTUAL, (s, j, n, dt) => {
        j.visible = false;
        return executePutGood(s, j, n, dt, invCtx);
    });
    choreoSystem.register(ChoreoTaskType.RESOURCE_GATHERING, (s, j, n, dt) =>
        executeResourceGathering(s, j, n, dt, invCtx)
    );
    choreoSystem.register(ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL, (s, j, n, dt) => {
        j.visible = false;
        return executeResourceGathering(s, j, n, dt, invCtx);
    });
    choreoSystem.register(ChoreoTaskType.LOAD_GOOD, (s, j, n, dt) => executeLoadGood(s, j, n, dt, invCtx));

    // ── Control ───────────────────────────────────────────────
    choreoSystem.register(ChoreoTaskType.WAIT, (s, j, n, dt) => executeWait(s, j, n, dt, ctrlCtx));
    choreoSystem.register(ChoreoTaskType.WAIT_VIRTUAL, (s, j, n, dt) => {
        j.visible = false;
        return executeWait(s, j, n, dt, ctrlCtx);
    });
    choreoSystem.register(ChoreoTaskType.CHECKIN, (s, j, n, dt) => executeCheckin(s, j, n, dt, ctrlCtx));
    choreoSystem.register(ChoreoTaskType.CHANGE_JOB, (s, j, n, dt) => executeChangeJob(s, j, n, dt, ctrlCtx));
    choreoSystem.register(ChoreoTaskType.CHANGE_JOB_COME_TO_WORK, (s, j, n, dt) =>
        executeChangeJob(s, j, n, dt, ctrlCtx)
    );
    choreoSystem.register(ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS, (s, j, n, dt) =>
        executeChangeTypeAtBarracks(s, j, n, dt, ctrlCtx)
    );
    choreoSystem.register(ChoreoTaskType.HEAL_ENTITY, (s, j, n, dt) => executeHealEntity(s, j, n, dt, ctrlCtx));
    choreoSystem.register(ChoreoTaskType.ATTACK_REACTION, (s, j, n, dt) => executeAttackReaction(s, j, n, dt, ctrlCtx));
}

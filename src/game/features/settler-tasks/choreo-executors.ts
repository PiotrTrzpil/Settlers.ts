/**
 * Choreography executor dispatch map.
 *
 * Maps every ChoreoTaskType to its concrete executor function, providing a
 * single exhaustive lookup for the choreography state machine.
 *
 * Usage:
 *   const executor = CHOREO_EXECUTOR_MAP[node.task];
 *   const result = executor(settler, job, node, dt, ctx);
 */

import { ChoreoTaskType, type ChoreoExecutorFn } from './choreo-types';

// Movement (Phase 2A + 2B)
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

// Work (Phase 2C + 2D)
import {
    executeWork,
    executeWorkOnEntity,
    executePlant,
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
    executeGetGoodVirtual,
    executePutGoodVirtual,
    executeResourceGatheringVirtual,
} from './internal/inventory-executors';

// Wait + Control
import {
    executeWait,
    executeWaitVirtual,
    executeCheckin,
    executeChangeJob,
    executeChangeJobComeToWork,
    executeChangeTypeAtBarracks,
    executeHealEntity,
    executeAttackReaction,
} from './internal/control-executors';

/**
 * Exhaustive ChoreoTaskType → ChoreoExecutorFn map.
 *
 * Every enum member must have an entry. The satisfies check below enforces
 * exhaustiveness at compile time — adding a new ChoreoTaskType without a
 * corresponding executor will produce a type error.
 */
export const CHOREO_EXECUTOR_MAP: Record<ChoreoTaskType, ChoreoExecutorFn> = {
    // Movement
    [ChoreoTaskType.GO_TO_TARGET]: executeGoToTarget,
    [ChoreoTaskType.GO_TO_TARGET_ROUGHLY]: executeGoToTargetRoughly,
    [ChoreoTaskType.GO_TO_POS]: executeGoToPos,
    [ChoreoTaskType.GO_TO_POS_ROUGHLY]: executeGoToPosRoughly,
    [ChoreoTaskType.GO_TO_SOURCE_PILE]: executeGoToSourcePile,
    [ChoreoTaskType.GO_TO_DESTINATION_PILE]: executeGoToDestinationPile,
    [ChoreoTaskType.GO_HOME]: executeGoHome,
    [ChoreoTaskType.GO_VIRTUAL]: executeGoVirtual,
    [ChoreoTaskType.SEARCH]: executeSearch,

    // Work
    [ChoreoTaskType.WORK]: executeWork,
    [ChoreoTaskType.WORK_ON_ENTITY]: executeWorkOnEntity,
    [ChoreoTaskType.WORK_VIRTUAL]: executeWorkVirtual,
    [ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL]: executeWorkOnEntityVirtual,
    [ChoreoTaskType.PRODUCE_VIRTUAL]: executeProduceVirtual,
    [ChoreoTaskType.PLANT]: executePlant,

    // Wait
    [ChoreoTaskType.WAIT]: executeWait,
    [ChoreoTaskType.WAIT_VIRTUAL]: executeWaitVirtual,

    // Inventory
    [ChoreoTaskType.GET_GOOD]: executeGetGood,
    [ChoreoTaskType.GET_GOOD_VIRTUAL]: executeGetGoodVirtual,
    [ChoreoTaskType.PUT_GOOD]: executePutGood,
    [ChoreoTaskType.PUT_GOOD_VIRTUAL]: executePutGoodVirtual,
    [ChoreoTaskType.RESOURCE_GATHERING]: executeResourceGathering,
    [ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL]: executeResourceGatheringVirtual,
    [ChoreoTaskType.LOAD_GOOD]: executeLoadGood,

    // Control
    [ChoreoTaskType.CHECKIN]: executeCheckin,
    [ChoreoTaskType.CHANGE_JOB]: executeChangeJob,
    [ChoreoTaskType.CHANGE_JOB_COME_TO_WORK]: executeChangeJobComeToWork,

    // Military (stubs)
    [ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS]: executeChangeTypeAtBarracks,
    [ChoreoTaskType.HEAL_ENTITY]: executeHealEntity,
    [ChoreoTaskType.ATTACK_REACTION]: executeAttackReaction,
};

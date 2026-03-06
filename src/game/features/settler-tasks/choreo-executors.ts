/**
 * Choreography executor dispatch — category-scoped maps.
 *
 * Replaces the single CHOREO_EXECUTOR_MAP with four per-category maps,
 * each typed to its narrow executor context. The TASK_CATEGORY map
 * classifies every ChoreoTaskType so the dispatcher can select the
 * right map and construct the minimal context.
 *
 * Usage (in WorkerTaskExecutor):
 *   const category = TASK_CATEGORY[node.task];
 *   switch (category) {
 *       case ExecutorCategory.MOVEMENT:
 *           return MOVEMENT_EXECUTORS[node.task](settler, job, node, dt, movementCtx);
 *       ...
 *   }
 */

import type { Entity } from '../../entity';
import {
    ChoreoTaskType,
    type ChoreoJobState,
    type ChoreoNode,
    type MovementExecutorFn,
    type WorkExecutorFn,
    type InventoryExecutorFn,
    type ControlExecutorFn,
} from './choreo-types';
import { TaskResult } from './types';

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

// Auto-recruit
import { executeTransformRecruit } from '../auto-recruit/recruitment-job';

// ─────────────────────────────────────────────────────────────
// Executor categories
// ─────────────────────────────────────────────────────────────

/** Executor category — determines which context type is constructed. */
export enum ExecutorCategory {
    MOVEMENT,
    WORK,
    INVENTORY,
    CONTROL,
}

// ─────────────────────────────────────────────────────────────
// Task → Category classification
// ─────────────────────────────────────────────────────────────

/** Maps every ChoreoTaskType to its executor category for context construction. */
export const TASK_CATEGORY: Record<ChoreoTaskType, ExecutorCategory> = {
    [ChoreoTaskType.GO_TO_TARGET]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_TARGET_ROUGHLY]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_POS]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_POS_ROUGHLY]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_SOURCE_PILE]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_DESTINATION_PILE]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_HOME]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_VIRTUAL]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.SEARCH]: ExecutorCategory.MOVEMENT,

    [ChoreoTaskType.WORK]: ExecutorCategory.WORK,
    [ChoreoTaskType.WORK_ON_ENTITY]: ExecutorCategory.WORK,
    [ChoreoTaskType.WORK_VIRTUAL]: ExecutorCategory.WORK,
    [ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL]: ExecutorCategory.WORK,
    [ChoreoTaskType.PRODUCE_VIRTUAL]: ExecutorCategory.WORK,
    [ChoreoTaskType.PLANT]: ExecutorCategory.WORK,

    [ChoreoTaskType.GET_GOOD]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.GET_GOOD_VIRTUAL]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.PUT_GOOD]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.PUT_GOOD_VIRTUAL]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.RESOURCE_GATHERING]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.LOAD_GOOD]: ExecutorCategory.INVENTORY,

    [ChoreoTaskType.WAIT]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.WAIT_VIRTUAL]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHECKIN]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHANGE_JOB]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHANGE_JOB_COME_TO_WORK]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.HEAL_ENTITY]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.ATTACK_REACTION]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.TRANSFORM_RECRUIT]: ExecutorCategory.CONTROL,
};

// ─────────────────────────────────────────────────────────────
// Virtual wrapper — creates a hidden variant of any executor
// ─────────────────────────────────────────────────────────────

type AnyExecutorFn = (settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number, ctx: never) => TaskResult;

/** Create a virtual (hidden) variant — wraps any executor to set job.visible=false. */
function asVirtual<Fn extends AnyExecutorFn>(fn: Fn): Fn {
    return ((settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number, ctx: never) => {
        job.visible = false;
        return fn(settler, job, node, dt, ctx);
    }) as Fn;
}

// ─────────────────────────────────────────────────────────────
// Per-category executor maps
// ─────────────────────────────────────────────────────────────

type MovementTaskType =
    | ChoreoTaskType.GO_TO_TARGET
    | ChoreoTaskType.GO_TO_TARGET_ROUGHLY
    | ChoreoTaskType.GO_TO_POS
    | ChoreoTaskType.GO_TO_POS_ROUGHLY
    | ChoreoTaskType.GO_TO_SOURCE_PILE
    | ChoreoTaskType.GO_TO_DESTINATION_PILE
    | ChoreoTaskType.GO_HOME
    | ChoreoTaskType.GO_VIRTUAL
    | ChoreoTaskType.SEARCH;

type WorkTaskType =
    | ChoreoTaskType.WORK
    | ChoreoTaskType.WORK_ON_ENTITY
    | ChoreoTaskType.WORK_VIRTUAL
    | ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL
    | ChoreoTaskType.PRODUCE_VIRTUAL
    | ChoreoTaskType.PLANT;

type InventoryTaskType =
    | ChoreoTaskType.GET_GOOD
    | ChoreoTaskType.GET_GOOD_VIRTUAL
    | ChoreoTaskType.PUT_GOOD
    | ChoreoTaskType.PUT_GOOD_VIRTUAL
    | ChoreoTaskType.RESOURCE_GATHERING
    | ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL
    | ChoreoTaskType.LOAD_GOOD;

type ControlTaskType =
    | ChoreoTaskType.WAIT
    | ChoreoTaskType.WAIT_VIRTUAL
    | ChoreoTaskType.CHECKIN
    | ChoreoTaskType.CHANGE_JOB
    | ChoreoTaskType.CHANGE_JOB_COME_TO_WORK
    | ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS
    | ChoreoTaskType.HEAL_ENTITY
    | ChoreoTaskType.ATTACK_REACTION
    | ChoreoTaskType.TRANSFORM_RECRUIT;

/** Movement executor map — GO_TO_*, SEARCH, GO_HOME, GO_VIRTUAL. */
export const MOVEMENT_EXECUTORS: Record<MovementTaskType, MovementExecutorFn> = {
    [ChoreoTaskType.GO_TO_TARGET]: executeGoToTarget,
    [ChoreoTaskType.GO_TO_TARGET_ROUGHLY]: executeGoToTargetRoughly,
    [ChoreoTaskType.GO_TO_POS]: executeGoToPos,
    [ChoreoTaskType.GO_TO_POS_ROUGHLY]: executeGoToPosRoughly,
    [ChoreoTaskType.GO_TO_SOURCE_PILE]: executeGoToSourcePile,
    [ChoreoTaskType.GO_TO_DESTINATION_PILE]: executeGoToDestinationPile,
    [ChoreoTaskType.GO_HOME]: executeGoHome,
    [ChoreoTaskType.GO_VIRTUAL]: executeGoVirtual,
    [ChoreoTaskType.SEARCH]: executeSearch,
};

/** Work executor map — WORK, WORK_ON_ENTITY, PLANT, *_VIRTUAL, PRODUCE_VIRTUAL. */
export const WORK_EXECUTORS: Record<WorkTaskType, WorkExecutorFn> = {
    [ChoreoTaskType.WORK]: executeWork,
    [ChoreoTaskType.WORK_ON_ENTITY]: executeWorkOnEntity,
    [ChoreoTaskType.WORK_VIRTUAL]: executeWorkVirtual,
    [ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL]: executeWorkOnEntityVirtual,
    [ChoreoTaskType.PRODUCE_VIRTUAL]: executeProduceVirtual,
    [ChoreoTaskType.PLANT]: executeWork,
};

/** Inventory executor map — GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, LOAD_GOOD, *_VIRTUAL. */
export const INVENTORY_EXECUTORS: Record<InventoryTaskType, InventoryExecutorFn> = {
    [ChoreoTaskType.GET_GOOD]: executeGetGood,
    [ChoreoTaskType.GET_GOOD_VIRTUAL]: asVirtual(executeGetGood),
    [ChoreoTaskType.PUT_GOOD]: executePutGood,
    [ChoreoTaskType.PUT_GOOD_VIRTUAL]: asVirtual(executePutGood),
    [ChoreoTaskType.RESOURCE_GATHERING]: executeResourceGathering,
    [ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL]: asVirtual(executeResourceGathering),
    [ChoreoTaskType.LOAD_GOOD]: executeLoadGood,
};

/** Control executor map — WAIT, CHECKIN, CHANGE_JOB, military stubs, auto-recruit. */
export const CONTROL_EXECUTORS: Record<ControlTaskType, ControlExecutorFn> = {
    [ChoreoTaskType.WAIT]: executeWait,
    [ChoreoTaskType.WAIT_VIRTUAL]: asVirtual(executeWait),
    [ChoreoTaskType.CHECKIN]: executeCheckin,
    [ChoreoTaskType.CHANGE_JOB]: executeChangeJob,
    [ChoreoTaskType.CHANGE_JOB_COME_TO_WORK]: executeChangeJob,
    [ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS]: executeChangeTypeAtBarracks,
    [ChoreoTaskType.HEAL_ENTITY]: executeHealEntity,
    [ChoreoTaskType.ATTACK_REACTION]: executeAttackReaction,
    [ChoreoTaskType.TRANSFORM_RECRUIT]: executeTransformRecruit,
};

/**
 * Core choreography types — zero feature dependencies.
 *
 * Defines the data model for choreography-based settler jobs: task types,
 * node structure, job runtime state, and the TaskResult enum.
 * These live in systems/ so any system (and features such as recruit) can
 * import them without pulling in feature-layer code.
 */

import { EMaterialType } from '../../economy';
import type { Tile, TileWithEntityOpt } from '@/game/core/coordinates';
import type { UnitType } from '@/game/core/unit-types';
import type { JobKind, JobParams } from './job-kind';

export { JobKind } from './job-kind';

// ─────────────────────────────────────────────────────────────
// ChoreoTaskType — 1:1 mapping from jobInfo.xml
// ─────────────────────────────────────────────────────────────

/** CEntityTask types from jobInfo.xml, mapped 1:1. */
export enum ChoreoTaskType {
    // Movement
    GO_TO_TARGET,
    GO_TO_TARGET_ROUGHLY,
    GO_TO_POS,
    GO_TO_POS_ROUGHLY,
    GO_TO_SOURCE_PILE,
    GO_TO_DESTINATION_PILE,
    GO_HOME,
    GO_VIRTUAL,
    SEARCH,

    // Work
    WORK,
    WORK_ON_ENTITY,
    WORK_VIRTUAL,
    WORK_ON_ENTITY_VIRTUAL,
    PRODUCE_VIRTUAL,
    PLANT,

    // Wait
    WAIT,
    WAIT_VIRTUAL,

    // Inventory
    GET_GOOD,
    GET_GOOD_VIRTUAL,
    PUT_GOOD,
    PUT_GOOD_VIRTUAL,
    RESOURCE_GATHERING,
    RESOURCE_GATHERING_VIRTUAL,
    LOAD_GOOD,

    // Control
    CHECKIN,
    CHANGE_JOB,
    CHANGE_JOB_COME_TO_WORK,

    // Military
    HEAL_ENTITY,
    ATTACK_REACTION,

    // Recruit
    TRANSFORM_RECRUIT,
    TRANSFORM_DIRECT = 'TRANSFORM_DIRECT',
    TRANSFORM_RECRUIT_BUILDING = 'TRANSFORM_RECRUIT_BUILDING',

    // Carrier transport (built dynamically via ChoreoBuilder, not parsed from XML)
    TRANSPORT_GO_TO_SOURCE = 'TRANSPORT_GO_TO_SOURCE',
    TRANSPORT_GO_TO_DEST = 'TRANSPORT_GO_TO_DEST',
    TRANSPORT_PICKUP = 'TRANSPORT_PICKUP',
    TRANSPORT_DELIVER = 'TRANSPORT_DELIVER',
    TRANSPORT_STAND_UP = 'TRANSPORT_STAND_UP',

    // Feature-layer dynamic tasks (registered at runtime, not parsed from XML)
    ENTER_BUILDING = 'ENTER_BUILDING',
    DIG_TILE = 'DIG_TILE',
    BUILD_STEP = 'BUILD_STEP',
}

/** Map task string (prefix-stripped at parse time) → ChoreoTaskType enum. */
const TASK_STRING_MAP: Record<string, ChoreoTaskType> = {
    GO_TO_TARGET: ChoreoTaskType.GO_TO_TARGET,
    GO_TO_TARGET_ROUGHLY: ChoreoTaskType.GO_TO_TARGET_ROUGHLY,
    GO_TO_POS: ChoreoTaskType.GO_TO_POS,
    GO_TO_POS_ROUGHLY: ChoreoTaskType.GO_TO_POS_ROUGHLY,
    GO_TO_SOURCE_PILE: ChoreoTaskType.GO_TO_SOURCE_PILE,
    GO_TO_DESTINATION_PILE: ChoreoTaskType.GO_TO_DESTINATION_PILE,
    GO_HOME: ChoreoTaskType.GO_HOME,
    GO_VIRTUAL: ChoreoTaskType.GO_VIRTUAL,
    SEARCH: ChoreoTaskType.SEARCH,
    WORK: ChoreoTaskType.WORK,
    WORK_ON_ENTITY: ChoreoTaskType.WORK_ON_ENTITY,
    WORK_VIRTUAL: ChoreoTaskType.WORK_VIRTUAL,
    WORK_ON_ENTITY_VIRTUAL: ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL,
    PRODUCE_VIRTUAL: ChoreoTaskType.PRODUCE_VIRTUAL,
    PLANT: ChoreoTaskType.PLANT,
    WAIT: ChoreoTaskType.WAIT,
    WAIT_VIRTUAL: ChoreoTaskType.WAIT_VIRTUAL,
    GET_GOOD: ChoreoTaskType.GET_GOOD,
    GET_GOOD_VIRTUAL: ChoreoTaskType.GET_GOOD_VIRTUAL,
    PUT_GOOD: ChoreoTaskType.PUT_GOOD,
    PUT_GOOD_VIRTUAL: ChoreoTaskType.PUT_GOOD_VIRTUAL,
    RESOURCE_GATHERING: ChoreoTaskType.RESOURCE_GATHERING,
    RESOURCE_GATHERING_VIRTUAL: ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL,
    LOAD_GOOD: ChoreoTaskType.LOAD_GOOD,
    CHECKIN: ChoreoTaskType.CHECKIN,
    CHANGE_JOB: ChoreoTaskType.CHANGE_JOB,
    CHANGE_JOB_COME_TO_WORK: ChoreoTaskType.CHANGE_JOB_COME_TO_WORK,
    HEAL_ENTITY: ChoreoTaskType.HEAL_ENTITY,
    ATTACK_REACTION: ChoreoTaskType.ATTACK_REACTION,
    TRANSFORM_RECRUIT: ChoreoTaskType.TRANSFORM_RECRUIT,
    TRANSFORM_DIRECT: ChoreoTaskType.TRANSFORM_DIRECT,
};

/** Parse a CEntityTask string from XML → ChoreoTaskType. Throws on unknown type. */
export function parseChoreoTaskType(taskString: string): ChoreoTaskType {
    const type = TASK_STRING_MAP[taskString];
    if (type === undefined) {
        throw new Error(`Unknown CEntityTask type: '${taskString}'. Known: ${Object.keys(TASK_STRING_MAP).join(', ')}`);
    }
    return type;
}

// ─────────────────────────────────────────────────────────────
// ChoreoNode — single step in a job choreography
// ─────────────────────────────────────────────────────────────

/**
 * Typed per-node data for builder-made nodes.
 * Ids only. ENTER_BUILDING / TRANSFORM_* are shared by several kinds, so their data belongs to
 * the node, not to any kind's params.
 */
export type ChoreoNodeArgs =
    | { readonly task: 'enterBuilding'; readonly buildingId: number }
    | { readonly task: 'digTile'; readonly siteId: number; readonly tileIndex: number }
    | { readonly task: 'buildStep'; readonly siteId: number }
    | { readonly task: 'transform'; readonly unitType: UnitType; readonly sourceId: number | null }
    | { readonly task: 'transport'; readonly recordId: number };

/** Single choreography node — direct mapping from jobInfo.xml <node>. */
export interface ChoreoNode {
    task: ChoreoTaskType;
    jobPart: string;
    x: number;
    y: number;
    duration: number;
    dir: number;
    forward: boolean;
    visible: boolean;
    useWork: boolean;
    entity: string;
    trigger: string;
    /**
     * Walk goal for builder-made GO_TO_TARGET / TRANSPORT_GO_TO_* nodes. Nullable by design: XML
     * nodes never carry one. When set, the GO_TO_TARGET executor
     * sets `job.targetPos = goal` and `job.targetId = goal.entityId ?? null` before walking.
     */
    goal?: TileWithEntityOpt;
    /** Typed node data (see {@link ChoreoNodeArgs}). Nullable by design: only builder-made nodes carry it. */
    args?: ChoreoNodeArgs;
}

/** A complete job choreography definition. */
export interface ChoreoJob {
    id: string;
    nodes: ChoreoNode[];
}

// ─────────────────────────────────────────────────────────────
// ChoreoJobState — runtime state for an active choreography job
// ─────────────────────────────────────────────────────────────

/** Runtime state for an active choreography job. */
export interface ChoreoJobState {
    readonly type: 'choreo';
    /** Job definition ID (e.g., 'JOB_WOODCUTTER_WORK' or 'CARRIER_TRANSPORT') — display / XML id. */
    jobId: string;
    /** Owner kind — the JobKindHandler that is called on completion / failure / unit removal. */
    readonly kind: JobKind;
    /** Owner's key (record / demand / tower id; Work: home building id or -1). */
    readonly ref: number;
    /**
     * Plain params the owner rebuilds the job from (persisted).
     * Mutable only for CHANGE_JOB, which re-targets a Work job to another XML id.
     */
    params: JobParams;
    /** Resolved choreography nodes — populated at job start, never re-looked-up during execution. */
    nodes: ChoreoNode[];
    /** Current node index in the choreography sequence */
    nodeIndex: number;
    /** Progress within current node (0-1) */
    progress: number;
    /** Whether the settler is currently visible */
    visible: boolean;
    /** Currently active trigger ID (for cleanup on interrupt/completion) */
    activeTrigger: string;
    /** Target entity found by SEARCH */
    targetId: number | null;
    /** Target position (from building position resolution) */
    targetPos: Tile | null;
    /** Approach position — adjacent tile the settler moves to when the target itself is non-walkable. */
    approachPos: Tile | null;
    /** Carried material (after GET_GOOD / RESOURCE_GATHERING) */
    carryingGood: EMaterialType | null;
    /** Whether work was started for current node (for cleanup tracking) */
    workStarted: boolean;
    /** Ticks to wait before retrying a failed pathfinding attempt (0 = try now). */
    pathRetryCountdown: number;
    /** Number of consecutive pathfinding failures (for exponential backoff). */
    pathRetryCount: number;
}

/** Owner identity of a new job state (see {@link createChoreoJobState}). */
export interface ChoreoJobOwner {
    readonly kind: JobKind;
    readonly ref: number;
    readonly params: JobParams;
}

/** Create a fresh ChoreoJobState for starting a job of `owner`. */
export function createChoreoJobState(jobId: string, nodes: ChoreoNode[], owner: ChoreoJobOwner): ChoreoJobState {
    const { kind, ref, params } = owner;
    return {
        type: 'choreo',
        jobId,
        kind,
        ref,
        params,
        nodes,
        nodeIndex: 0,
        progress: -1,
        visible: true,
        activeTrigger: '',
        targetId: null,
        targetPos: null,
        approachPos: null,
        carryingGood: null,
        workStarted: false,
        pathRetryCountdown: 0,
        pathRetryCount: 0,
    };
}

// ─────────────────────────────────────────────────────────────
// TaskResult
// ─────────────────────────────────────────────────────────────

/** Result of executing a choreography task node. */
export enum TaskResult {
    /** Task completed — move to next node. */
    DONE = 'DONE',
    /** Task in progress — continue next tick. */
    CONTINUE = 'CONTINUE',
    /** Task failed — abort entire job. */
    FAILED = 'FAILED',
}

// ─────────────────────────────────────────────────────────────
// Timing utilities
// ─────────────────────────────────────────────────────────────

/** jobInfo.xml durations are in animation frames at 10fps (100 ms per frame). */
export const CHOREO_FPS = 10;

/** Convert frame count to seconds. */
export function framesToSeconds(frames: number): number {
    return frames / CHOREO_FPS;
}

/**
 * Tick duration-based progress on a job. Advances job.progress by dt/durationSeconds.
 * Returns DONE when progress >= 1 or duration is non-positive/infinite, CONTINUE otherwise.
 */
export function tickDuration(job: ChoreoJobState, dt: number, durationSeconds: number): TaskResult {
    if (durationSeconds <= 0 || durationSeconds === Infinity) {
        return TaskResult.DONE;
    }
    job.progress += dt / durationSeconds;
    return job.progress >= 1 ? TaskResult.DONE : TaskResult.CONTINUE;
}

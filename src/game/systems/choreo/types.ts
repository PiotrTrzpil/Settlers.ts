/**
 * Core choreography types — zero feature dependencies.
 *
 * Defines the data model for choreography-based settler jobs: task types,
 * node structure, job runtime state, and the TaskResult enum.
 * These live in systems/ so any system (including systems/recruit/) can
 * import them without pulling in feature-layer code.
 */

import { EMaterialType } from '../../economy';

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
    CHANGE_TYPE_AT_BARRACKS,
    HEAL_ENTITY,
    ATTACK_REACTION,

    // Recruit
    TRANSFORM_RECRUIT,
    TRANSFORM_DIRECT = 'TRANSFORM_DIRECT',
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
    CHANGE_TYPE_AT_BARRACKS: ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS,
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
}

/** A complete job choreography definition. */
export interface ChoreoJob {
    id: string;
    nodes: ChoreoNode[];
}

// ─────────────────────────────────────────────────────────────
// TransportData — carrier transport metadata
// ─────────────────────────────────────────────────────────────

/** Transport metadata stored on ChoreoJobState for carrier transport jobs. */
export interface TransportData {
    /** Transport job record ID — used to call TransportJobOps lifecycle methods. */
    jobId: number;
    /** Source building entity ID (pickup location). */
    sourceBuildingId: number;
    /** Destination building entity ID (delivery location). */
    destBuildingId: number;
    /** Material being transported. */
    material: EMaterialType;
    /** Amount to transport (may be reduced after pickup if source had less). */
    amount: number;
    /** Pre-resolved source position (output pile / door for pickup). */
    sourcePos: { x: number; y: number };
    /** Pre-resolved destination position (input pile / door for delivery). */
    destPos: { x: number; y: number };
}

// ─────────────────────────────────────────────────────────────
// ChoreoJobState — runtime state for an active choreography job
// ─────────────────────────────────────────────────────────────

/** Runtime state for an active choreography job. */
export interface ChoreoJobState {
    readonly type: 'choreo';
    /** Job definition ID (e.g., 'JOB_WOODCUTTER_WORK' or 'CARRIER_TRANSPORT') */
    jobId: string;
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
    targetPos: { x: number; y: number } | null;
    /** Carried material (after GET_GOOD / RESOURCE_GATHERING) */
    carryingGood: EMaterialType | null;
    /** Whether work was started for current node (for cleanup tracking) */
    workStarted: boolean;
    /** Transport data for carrier jobs (GET_GOOD / PUT_GOOD transport branches). */
    transportData?: TransportData;
    /** Ticks to wait before retrying a failed pathfinding attempt (0 = try now). */
    pathRetryCountdown: number;
}

/** Create a fresh ChoreoJobState for starting a job. */
export function createChoreoJobState(jobId: string, nodes: ChoreoNode[] = []): ChoreoJobState {
    return {
        type: 'choreo',
        jobId,
        nodes,
        nodeIndex: 0,
        progress: -1,
        visible: true,
        activeTrigger: '',
        targetId: null,
        targetPos: null,
        carryingGood: null,
        workStarted: false,
        pathRetryCountdown: 0,
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
    if (durationSeconds <= 0 || durationSeconds === Infinity) return TaskResult.DONE;
    job.progress += dt / durationSeconds;
    return job.progress >= 1 ? TaskResult.DONE : TaskResult.CONTINUE;
}

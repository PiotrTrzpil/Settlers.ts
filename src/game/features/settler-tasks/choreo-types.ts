/**
 * Choreography types — direct mapping from jobInfo.xml.
 *
 * Replaces the YAML-driven TaskType/TaskNode with richer nodes
 * that faithfully replicate the original Settlers 4 engine's job execution.
 */

import type { Entity } from '../../entity';
import type { EMaterialType } from '../../economy';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager, InventoryVisualizer } from '../inventory';
import type { CarrierManager } from '../carriers';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { JobType, type EntityWorkHandler, type PositionWorkHandler, type TaskResult } from './types';

// ─────────────────────────────────────────────────────────────
// CEntityTask types — 1:1 mapping from jobInfo.xml
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
// Choreography job runtime state
// ─────────────────────────────────────────────────────────────

/** Runtime state for an active choreography job. */
export interface ChoreoJobState {
    /** Discriminator for JobState union (ChoreoJobState | CarrierJobState). */
    type: JobType.CHOREO;
    /** Job definition ID (e.g., 'JOB_WOODCUTTER_WORK') */
    jobId: string;
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
}

/** Create a fresh ChoreoJobState for starting a job. */
export function createChoreoJobState(jobId: string): ChoreoJobState {
    return {
        type: JobType.CHOREO,
        jobId,
        nodeIndex: 0,
        progress: 0,
        visible: true,
        activeTrigger: '',
        targetId: null,
        targetPos: null,
        carryingGood: null,
        workStarted: false,
    };
}

// ─────────────────────────────────────────────────────────────
// Executor context and function signature
// ─────────────────────────────────────────────────────────────

/** JobPart resolution result for animation playback. */
export interface JobPartResolution {
    sequenceKey: string;
    loop: boolean;
    stopped: boolean;
}

/** Resolves jobPart strings to animation sequence keys. */
export interface JobPartResolver {
    resolve(jobPart: string, settler: Entity): JobPartResolution;
}

/** Converts building-relative (x, y) to world hex coordinates. */
export interface BuildingPositionResolver {
    /** Resolve (buildingId, x, y, useWork) → world hex position. */
    resolvePosition(buildingId: number, x: number, y: number, useWork: boolean): { x: number; y: number };
    /** Get source pile (input stack) position for a building. */
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null;
    /** Get destination pile (output stack) position for a building. */
    getDestinationPilePosition(buildingId: number, material: string): { x: number; y: number } | null;
}

/** Fires building overlay animations from trigger IDs. */
export interface TriggerSystem {
    fireTrigger(buildingId: number, triggerId: string): void;
    stopTrigger(buildingId: number, triggerId: string): void;
}

/** Services bundled for choreography executors. */
export interface ChoreoContext {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    inventoryVisualizer: InventoryVisualizer;
    carrierManager: CarrierManager;
    eventBus: EventBus;
    handlerErrorLogger: ThrottledLogger;
    jobPartResolver: JobPartResolver;
    buildingPositionResolver: BuildingPositionResolver;
    triggerSystem: TriggerSystem;
    /** Resolve the home building ID for a worker settler. */
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    /** Domain work handlers (tree, stone, crop, etc.) */
    entityHandler?: EntityWorkHandler;
    positionHandler?: PositionWorkHandler;
}

/** Signature for a single choreography node executor. */
export type ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext
) => TaskResult;

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** jobInfo.xml uses 25fps for frame-based durations. */
export const CHOREO_FPS = 25;

/** Convert frame count to seconds. */
export function framesToSeconds(frames: number): number {
    return frames / CHOREO_FPS;
}

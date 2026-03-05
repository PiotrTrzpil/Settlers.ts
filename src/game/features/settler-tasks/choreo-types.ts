/**
 * Choreography types — direct mapping from jobInfo.xml.
 *
 * Replaces the YAML-driven TaskType/TaskNode with richer nodes
 * that faithfully replicate the original Settlers 4 engine's job execution.
 */

import type { Entity } from '../../entity';
import { EMaterialType } from '../../economy';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager } from '../inventory';
import type { CarrierManager } from '../carriers';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { JobType, type EntityWorkHandler, type PositionWorkHandler, type TaskResult } from './types';
import type { TransportJob } from '../logistics/transport-job';
import type { BarracksTrainingManager } from '../barracks';
import type { Command, CommandResult } from '../../commands';

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

// ─────────────────────────────────────────────────────────────
// Transport data — for carrier transport jobs via choreography
// ─────────────────────────────────────────────────────────────

/** Carrier transport data stored on ChoreoJobState for TRANSPORT_* task types. */
export interface TransportData {
    /** The TransportJob that owns reservation and request lifecycle. */
    transportJob: TransportJob;
    /** Source building entity ID (pickup location). */
    sourceBuildingId: number;
    /** Destination building entity ID (delivery location). */
    destBuildingId: number;
    /** Material being transported. */
    material: EMaterialType;
    /** Amount to transport. */
    amount: number;
    /** Pre-resolved source position (output pile / door for pickup). */
    sourcePos: { x: number; y: number };
    /** Pre-resolved destination position (input pile / door for delivery). */
    destPos: { x: number; y: number };
}

/** Runtime state for an active choreography job. */
export interface ChoreoJobState {
    type: JobType.CHOREO;
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
}

/** Create a fresh ChoreoJobState for starting a job. */
export function createChoreoJobState(jobId: string, nodes: ChoreoNode[] = []): ChoreoJobState {
    return {
        type: JobType.CHOREO,
        jobId,
        nodes,
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
}

/** Fires building overlay animations from trigger IDs. */
export interface TriggerSystem {
    fireTrigger(buildingId: number, triggerId: string): void;
    stopTrigger(buildingId: number, triggerId: string): void;
}

/**
 * Context required by movement-phase executors (GO_TO_TARGET, GO_HOME, SEARCH, …).
 *
 * Used by: movement-executors.ts
 * Fields: gameState (entity lookup, movement commands), buildingPositionResolver (building-relative
 * offset → world coords), getWorkerHomeBuilding (settler → home building mapping),
 * entityHandler/positionHandler (SEARCH target finding).
 */
export interface MovementContext {
    gameState: GameState;
    buildingPositionResolver: BuildingPositionResolver;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    handlerErrorLogger: ThrottledLogger;
    entityHandler?: EntityWorkHandler;
    positionHandler?: PositionWorkHandler;
}

/**
 * Context required by work-phase executors (WORK, WORK_ON_ENTITY, PRODUCE_VIRTUAL, …).
 *
 * Used by: work-executors.ts
 * Fields: gameState (entity lookup), triggerSystem (building overlay animations),
 * getWorkerHomeBuilding (home building ID), entityHandler/positionHandler (work completion callbacks).
 */
export interface WorkContext {
    gameState: GameState;
    triggerSystem: TriggerSystem;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    handlerErrorLogger: ThrottledLogger;
    entityHandler?: EntityWorkHandler;
    positionHandler?: PositionWorkHandler;
}

/**
 * Context required by inventory executors (GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, …).
 *
 * Used by: inventory-executors.ts
 * Fields: inventoryManager (withdraw/deposit operations), getWorkerHomeBuilding (settler → building mapping).
 */
export interface InventoryContext {
    inventoryManager: BuildingInventoryManager;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
}

/**
 * Context required by transport (carrier) executors.
 *
 * Used by: transport-executors.ts
 * Fields: eventBus (carrier lifecycle events), carrierManager (status transitions).
 */
export interface TransportContext {
    eventBus: EventBus;
    carrierManager: CarrierManager;
}

/**
 * Full service bag for choreography executors — composes all phase-specific contexts.
 *
 * Each executor only uses a subset of this context:
 * - Movement executors (GO_TO_*, SEARCH): MovementContext fields
 * - Work executors (WORK, WORK_ON_ENTITY, PLANT): WorkContext fields
 * - Inventory executors (GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, LOAD_GOOD): InventoryContext fields
 * - Transport executors (carrier branches of GET_GOOD/PUT_GOOD): TransportContext fields
 *
 * The sub-interfaces above document which fields each phase requires.
 * Ancillary services (jobPartResolver, executeCommand) are used by the task
 * system itself rather than by individual executor functions.
 */
export interface ChoreoContext extends MovementContext, WorkContext, InventoryContext, TransportContext {
    jobPartResolver: JobPartResolver;
    /** Barracks training manager — optional, only set when barracks feature is active. */
    barracksTrainingManager?: BarracksTrainingManager;
    /** Command executor for entity creation/removal during simulation. */
    executeCommand: (cmd: Command) => CommandResult;
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

/** jobInfo.xml durations are in animation frames at 10fps (100 ms per frame). */
export const CHOREO_FPS = 10;

/** Convert frame count to seconds. */
export function framesToSeconds(frames: number): number {
    return frames / CHOREO_FPS;
}

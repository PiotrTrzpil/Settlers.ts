/**
 * Choreography types — feature-layer extensions.
 *
 * Re-exports pure data types from systems/choreo/ and adds the
 * feature-dependent context interfaces and executor function signatures.
 */

import type { Entity } from '../../entity';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager } from '../inventory';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type { EntityWorkHandler, PositionWorkHandler } from './types';
import type { BarracksTrainingManager } from '../barracks';
import type { MaterialTransfer } from '../material-transfer';
import type { Command, CommandResult } from '../../commands';
import type { TransportJobRecord } from '../logistics/transport-job-record';
import type { TaskResult, ChoreoJobState, ChoreoNode } from '../../systems/choreo';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';

// Re-export everything from systems/choreo so existing importers don't need to change paths.
export {
    ChoreoTaskType,
    parseChoreoTaskType,
    type ChoreoNode,
    type ChoreoJob,
    type TransportData,
    type ChoreoJobState,
    createChoreoJobState,
    CHOREO_FPS,
    framesToSeconds,
    tickDuration,
    choreo,
    node,
    ChoreoBuilder,
} from '../../systems/choreo';

// ─────────────────────────────────────────────────────────────
// TransportJobOps — stays here (references TransportJobRecord from logistics)
// ─────────────────────────────────────────────────────────────

/** Transport job lifecycle operations — injected into executor context. */
export interface TransportJobOps {
    getJob(jobId: number): TransportJobRecord | undefined;
    /** Consume reservation after carrier picks up material. Returns false if job no longer exists. */
    pickUp(jobId: number): boolean;
    /** Fulfill request after carrier delivers material. Returns false if job no longer exists. */
    deliver(jobId: number): boolean;
    cancel(jobId: number): void;
}

// ─────────────────────────────────────────────────────────────
// JobPart resolution
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
    /** Get the source (input) pile position for a material at a building. */
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null;
    /** Get the destination (output) pile position for a material at a building. */
    getDestinationPilePosition(buildingId: number, material: string): { x: number; y: number } | null;
    /** Get the work area radius (in tiles) for a building. Returns 0 if no work area. */
    getWorkAreaRadius(buildingId: number): number;
}

/** Fires building overlay animations from trigger IDs. */
export interface TriggerSystem {
    fireTrigger(buildingId: number, triggerId: string): void;
    stopTrigger(buildingId: number, triggerId: string): void;
}

// ─────────────────────────────────────────────────────────────
// Executor context interfaces — each typed to the minimum needed
// ─────────────────────────────────────────────────────────────

/**
 * Context required by movement-phase executors (GO_TO_TARGET, GO_HOME, SEARCH, …).
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
 */
export interface InventoryContext {
    inventoryManager: BuildingInventoryManager;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
}

/**
 * Extended inventory context for executors that handle both worker and carrier paths.
 */
export interface InventoryExecutorContext extends InventoryContext {
    materialTransfer: MaterialTransfer;
    eventBus: EventBus;
    transportJobOps: TransportJobOps;
    /** Used by TRANSPORT_DELIVER to emit construction:materialDelivered on construction sites. */
    constructionSiteManager: ConstructionSiteManager;
}

/**
 * Context for control executors (WAIT, CHECKIN, CHANGE_JOB, military stubs).
 * Minimal — most control nodes are timers or state transitions.
 */
export interface ControlContext {
    gameState: GameState;
    eventBus: EventBus;
    handlerErrorLogger: ThrottledLogger;
    /** Barracks training manager — only needed by CHANGE_TYPE_AT_BARRACKS. */
    barracksTrainingManager?: BarracksTrainingManager;
    /** Command executor — needed by TRANSFORM_RECRUIT. */
    executeCommand?: (cmd: Command) => CommandResult;
    /** Inventory manager — needed by TRANSFORM_RECRUIT for pile withdrawal. */
    inventoryManager?: BuildingInventoryManager;
}

// ─────────────────────────────────────────────────────────────
// Category-scoped executor function types
// ─────────────────────────────────────────────────────────────

/** Movement executor — GO_TO_*, SEARCH, GO_HOME, GO_VIRTUAL */
export type MovementExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: MovementContext
) => TaskResult;

/** Work executor — WORK, WORK_ON_ENTITY, PLANT, *_VIRTUAL, PRODUCE_VIRTUAL */
export type WorkExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
) => TaskResult;

/** Inventory executor — GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, LOAD_GOOD, *_VIRTUAL */
export type InventoryExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: InventoryExecutorContext
) => TaskResult;

/** Control executor — WAIT, CHECKIN, CHANGE_JOB, military stubs */
export type ControlExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ControlContext
) => TaskResult;

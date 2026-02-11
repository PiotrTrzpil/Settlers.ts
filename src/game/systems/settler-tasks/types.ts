/**
 * Types for the settler task system.
 */

import type { EMaterialType } from '../../economy';

/** Task types - atomic actions a settler can perform */
export enum TaskType {
    /** Move to target entity */
    GO_TO_TARGET = 'GO_TO_TARGET',
    /** Move to specific position */
    GO_TO_POS = 'GO_TO_POS',
    /** Move to source pile (for carriers) */
    GO_TO_SOURCE = 'GO_TO_SOURCE',
    /** Move to destination pile (for carriers) */
    GO_TO_DEST = 'GO_TO_DEST',
    /** Return to home building */
    GO_HOME = 'GO_HOME',
    /** Search for a position (e.g., where to plant) */
    SEARCH_POS = 'SEARCH_POS',
    /** Work on target entity (tree, stone, etc.) */
    WORK_ON_ENTITY = 'WORK_ON_ENTITY',
    /** Stay at current position indefinitely (for building workers) */
    STAY = 'STAY',
    /** Generic work at current position */
    WORK = 'WORK',
    /** Wait for duration */
    WAIT = 'WAIT',
    /** Pick up resource */
    PICKUP = 'PICKUP',
    /** Drop off resource */
    DROPOFF = 'DROPOFF',
}

/** Search types - what a settler looks for */
export enum SearchType {
    TREE = 'TREE',
    TREE_SEED_POS = 'TREE_SEED_POS',
    STONE = 'STONE',
    FISH = 'FISH',
    VENISON = 'VENISON',
    GRAIN = 'GRAIN',
    RESOURCE_POS = 'RESOURCE_POS',
    GOOD = 'GOOD',
    CONSTRUCTION = 'CONSTRUCTION',
    TERRAIN = 'TERRAIN',
    FORGE = 'FORGE',
    /** Worker goes to their assigned workplace building and stays there */
    WORKPLACE = 'WORKPLACE',
}

/**
 * Animation action names used in job YAML files.
 * These are semantic actions that get resolved to full animation names
 * via settlerAnim(unitType, action).
 *
 * Universal actions (all settlers):
 *   - walk: walking without cargo
 *   - idle: standing idle
 *   - carry: walking with cargo (resolved with material type)
 *   - pickup: picking up resource
 *   - dropoff: dropping off resource
 *
 * Settler-specific work actions:
 *   - chop: woodcutter chopping tree
 *   - harvest: farmer harvesting grain
 *   - plant: forester/farmer planting
 *   - mine: miner mining
 *   - hammer: builder/smith working
 *   - dig: digger landscaping
 */
export type AnimationType =
    // Universal actions
    | 'walk'
    | 'idle'
    | 'carry'
    | 'pickup'
    | 'dropoff'
    // Settler-specific work actions
    | 'chop'
    | 'harvest'
    | 'plant'
    | 'mine'
    | 'hammer'
    | 'dig'
    | 'work'; // Generic work (sawmill worker, etc.)

/** A single task node in a job sequence */
export interface TaskNode {
    task: TaskType;
    anim: AnimationType;
    /** Duration in seconds (for WORK tasks) */
    duration?: number;
    /** Good type to pick up/drop off */
    good?: EMaterialType;
}

/** A job is a named sequence of tasks */
export interface JobDefinition {
    id: string;
    tasks: TaskNode[];
}

/** Settler type configuration from YAML */
export interface SettlerConfig {
    search: SearchType;
    tool?: EMaterialType;
    jobs: string[];
}

/** Result of executing a task */
export enum TaskResult {
    /** Task completed, move to next */
    DONE = 'DONE',
    /** Task in progress, continue next tick */
    CONTINUE = 'CONTINUE',
    /** Task failed, abort job */
    FAILED = 'FAILED',
}

/** Runtime state for a settler executing a job */
export interface SettlerJobState {
    /** Current job ID (e.g., 'woodcutter.work') */
    jobId: string;
    /** Current task index in the job */
    taskIndex: number;
    /** Progress within current task (0-1) */
    progress: number;
    /** Target entity ID (tree, stone, building, etc.) */
    targetId: number | null;
    /** Target position */
    targetPos: { x: number; y: number } | null;
    /** Home building ID */
    homeId: number | null;
    /** Carried good type */
    carryingGood: EMaterialType | null;
    /** Whether onWorkStart was called (for proper cleanup) */
    workStarted?: boolean;
}

/** Extended job state for carrier transport jobs */
export interface CarrierJobState extends SettlerJobState {
    /** Source building for pickup */
    sourceBuildingId: number;
    /** Destination building for delivery */
    destBuildingId: number;
    /** Material type being transported */
    material: EMaterialType;
    /** Amount to transport */
    amount: number;
}

/** High-level settler state */
export enum SettlerState {
    /** Waiting for work */
    IDLE = 'IDLE',
    /** Executing a job */
    WORKING = 'WORKING',
    /** Job interrupted (attacked, target gone, etc.) */
    INTERRUPTED = 'INTERRUPTED',
}

/** Work handler provided by domain systems (e.g., WoodcuttingSystem) */
export interface WorkHandler {
    /** Find a target for this settler */
    findTarget(x: number, y: number, settlerId?: number): { entityId: number; x: number; y: number } | null;
    /** Check if target is still valid / has materials to work with */
    canWork(targetId: number): boolean;
    /** If true, worker waits (idles) when canWork is false instead of failing */
    shouldWaitForWork?: boolean;
    /** Called when WORK_ON_ENTITY starts */
    onWorkStart?(targetId: number): void;
    /** Called each tick during WORK_ON_ENTITY, return true when done */
    onWorkTick(targetId: number, progress: number): boolean;
    /** Called when work completes */
    onWorkComplete?(targetId: number, settlerX: number, settlerY: number): void;
    /** Called if work is interrupted */
    onWorkInterrupt?(targetId: number): void;
}

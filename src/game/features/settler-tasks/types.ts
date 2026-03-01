/**
 * Types for the settler task system.
 */

import type { ChoreoJobState } from './choreo-types';

/** Search types - what a settler looks for */
export enum SearchType {
    TREE = 'TREE',
    TREE_SEED_POS = 'TREE_SEED_POS',
    GRAIN_SEED_POS = 'GRAIN_SEED_POS',
    SUNFLOWER_SEED_POS = 'SUNFLOWER_SEED_POS',
    AGAVE_SEED_POS = 'AGAVE_SEED_POS',
    BEEHIVE_SEED_POS = 'BEEHIVE_SEED_POS',
    VINE_SEED_POS = 'VINE_SEED_POS',
    STONE = 'STONE',
    FISH = 'FISH',
    VENISON = 'VENISON',
    GRAIN = 'GRAIN',
    SUNFLOWER = 'SUNFLOWER',
    AGAVE = 'AGAVE',
    BEEHIVE = 'BEEHIVE',
    VINE = 'VINE',
    /** Waterworker finds a river tile within work area to draw water */
    WATER = 'WATER',
    RESOURCE_POS = 'RESOURCE_POS',
    GOOD = 'GOOD',
    CONSTRUCTION = 'CONSTRUCTION',
    TERRAIN = 'TERRAIN',
    FORGE = 'FORGE',
    /** Worker goes to their assigned workplace building and stays there */
    WORKPLACE = 'WORKPLACE',
}

/** Settler type configuration from SettlerValues.xml */
export interface SettlerConfig {
    search: SearchType;
    /**
     * Secondary search type for planting/seeding (e.g. GRAIN_SEED_POS for farmer).
     * When set, the position handler is looked up via this search type instead of `search`.
     * This enables dual-mode settlers: harvest via entity handler + plant via position handler.
     */
    plantSearch?: SearchType;
    /** Work job IDs from jobInfo.xml (filtered from animLists, excludes CHECKIN/IDLE). */
    jobs: string[];
    /**
     * Per-building job lists for settlers whose jobs come from building XML
     * (e.g. SETTLER_MINEWORKER — one settler type serving multiple mine buildings).
     * When set, selectJob filters `jobs` to only those matching the assigned building.
     * Key is BuildingType enum value.
     */
    buildingJobs?: Map<number, string[]>;
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

/** Job ID for carrier transport (not XML-defined — inline choreography built programmatically). */
export const CARRIER_TRANSPORT_JOB_ID = 'CARRIER_TRANSPORT';

/** Job state for an active settler job. */
export type JobState = ChoreoJobState;

/** Job type discriminator (single variant — kept for structural consistency). */
export enum JobType {
    CHOREO = 'choreo',
}

/** Discriminator for WorkHandler union. */
export enum WorkHandlerType {
    ENTITY = 'entity',
    POSITION = 'position',
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

/** Handler for entity-targeted work: SEARCH → GO_TO_TARGET → WORK_ON_ENTITY */
export interface EntityWorkHandler {
    type: WorkHandlerType.ENTITY;
    /** Find a target entity for this settler */
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

/** Handler for position-based work: SEARCH → GO_TO_POS → WORK */
export interface PositionWorkHandler {
    type: WorkHandlerType.POSITION;
    /** Find a position to work at */
    findPosition(x: number, y: number, settlerId?: number): { x: number; y: number } | null;
    /** If true, worker waits (idles) when no position is found instead of failing */
    shouldWaitForWork?: boolean;
    /** Called when WORK task completes at searched position */
    onWorkAtPositionComplete(x: number, y: number, settlerId: number): void;
}

/** Discriminated union of work handler types */
export type WorkHandler = EntityWorkHandler | PositionWorkHandler;

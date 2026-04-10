/**
 * Types for the settler task system.
 */

import type { ChoreoJobState, SearchArea } from './choreo-types';
import type { BuildingType } from '../../buildings/building-type';
import type { UnitType, Tile, TileWithEntity } from '../../entity';

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
    CONSTRUCTION_DIG = 'CONSTRUCTION_DIG',
    TERRAIN = 'TERRAIN',
    FORGE = 'FORGE',
    /** Worker goes to their assigned workplace building and stays there */
    WORKPLACE = 'WORKPLACE',
    /** No autonomous work search — unit only executes externally-assigned dispatch jobs. */
    NONE = 'NONE',
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
    buildingJobs?: Map<BuildingType, string[]>;
}

/**
 * Config for units that don't search for work autonomously but can execute
 * externally-assigned choreo jobs (e.g. military garrison dispatch).
 */
export const DISPATCH_ONLY_CONFIG: SettlerConfig = { search: SearchType.NONE, jobs: [] };

export { TaskResult } from '../../systems/choreo';

/** Tracks a worker's assigned workplace building and whether they've visited it. */
export interface HomeAssignment {
    readonly buildingId: number;
    /** True once the worker has walked to the building for the first time. */
    hasVisited: boolean;
}

/** Job state for an active settler job. */
export type JobState = ChoreoJobState;

/** Job type discriminator (single variant — kept for structural consistency). */
export enum JobType {
    CHOREO = 'choreo',
}

/** Discriminator for WorkHandler union. */
export enum WorkHandlerType {
    /** Externally dispatched — no autonomous search (carriers, builders, diggers). */
    NULL = 'null',
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

// ── Shared work lifecycle interfaces ──

/** Entity work lifecycle — shared by all handlers that produce entity targets. */
export interface EntityWorkLifecycle {
    canWork(targetId: number): boolean;
    shouldWaitForWork?: boolean;
    onWorkStart?(targetId: number, settlerId: number): void;
    onWorkTick(targetId: number, progress: number): boolean;
    onWorkComplete?(targetId: number, settlerX: number, settlerY: number, settlerId: number): void;
    onWorkInterrupt?(targetId: number, settlerId: number): void;
}

/** Position work lifecycle — shared by all handlers that produce position targets. */
export interface PositionWorkLifecycle {
    shouldWaitForWork?: boolean;
    onWorkAtPositionComplete(tile: Tile, settlerId: number): void;
    onSettlerRemoved?(settlerId: number, targetX?: number, targetY?: number): void;
}

// ── Handler interfaces ──

/** Handler for externally-dispatched settlers that never search autonomously. */
export interface NullWorkHandler {
    type: WorkHandlerType.NULL;
    shouldWaitForWork?: boolean;
}

/** Handler for entity-targeted work: SEARCH → GO_TO_TARGET → WORK_ON_ENTITY */
export interface EntityWorkHandler extends EntityWorkLifecycle {
    type: WorkHandlerType.ENTITY;
    findTarget(area: SearchArea, settlerId: number, player: number): TileWithEntity | null;
}

/** Handler for position-based work: SEARCH → GO_TO_POS → WORK */
export interface PositionWorkHandler extends PositionWorkLifecycle {
    type: WorkHandlerType.POSITION;
    findPosition(area: SearchArea, settlerId: number): Tile | null;
}

/** Discriminated union of all work handler types. */
export type WorkHandler = NullWorkHandler | EntityWorkHandler | PositionWorkHandler;

/** Narrow interface for assigning tasks to units. Used by logistics, building-demand, siege, etc. */
export interface TaskDispatcher {
    assignJob(entityId: number, job: ChoreoJobState, moveTo?: Tile): boolean;
    assignMoveTask(entityId: number, target: Tile): boolean;
    assignWorkerToBuilding(settlerId: number, buildingId: number): void;
    releaseWorkerAssignment(settlerId: number): void;
    findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null;
}

/** Narrow read-only interface for querying worker state. Used by logistics diagnostics. */
export interface WorkerStateQuery {
    getActiveJobId(entityId: number): string | null;
    getSettlerState(entityId: number): SettlerState | null;
    getAssignedBuilding(settlerId: number): number | null;
    getWorkersForBuilding(buildingId: number): ReadonlySet<number>;
}

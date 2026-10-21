/**
 * Types for the settler task system.
 */

import type { ChoreoJobState } from './choreo-types';
import type { BuildingType } from '../../buildings/building-type';
import type { Tile } from '../../entity';
import type { CommitmentOwner } from '../../systems/unit-commitment';

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

// Work handler contract lives in the domain-free choreo runtime; re-exported for feature importers.
export {
    WorkHandlerType,
    type EntityWorkLifecycle,
    type PositionWorkLifecycle,
    type NullWorkHandler,
    type EntityWorkHandler,
    type PositionWorkHandler,
    type WorkHandler,
} from '../../systems/choreo';

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

/** High-level settler state */
export enum SettlerState {
    /** Waiting for work */
    IDLE = 'IDLE',
    /** Executing a job */
    WORKING = 'WORKING',
    /** Job interrupted (attacked, target gone, etc.) */
    INTERRUPTED = 'INTERRUPTED',
}

/**
 * Narrow interface for move tasks (player moves, siege moves). Implemented by JobRunner.
 * Jobs go through `JobService.assign`.
 */
export interface TaskDispatcher {
    /**
     * Move task: drops the current job and home assignment, then walks to `target`.
     * `owner` 'player-move' (default) or 'siege' (the unit must be held by the siege already).
     */
    assignMoveTask(entityId: number, target: Tile, owner?: CommitmentOwner): boolean;
}

/** Narrow read-only interface for querying a unit's job state. Implemented by JobRunner. */
export interface WorkerStateQuery {
    getActiveJobId(entityId: number): string | null;
    getSettlerState(entityId: number): SettlerState | null;
}

/** Narrow read-only interface for querying home-building assignments. Implemented by WorkerAssignments. */
export interface WorkerAssignmentQuery {
    getAssignedBuilding(settlerId: number): number | null;
    getWorkersForBuilding(buildingId: number): ReadonlySet<number>;
}

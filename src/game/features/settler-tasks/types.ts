/**
 * Types for the settler task system.
 */

import type { EMaterialType } from '../../economy';
import type { TransportJob } from '../logistics/transport-job';
import type { ChoreoJobState } from './choreo-types';

/** Search types - what a settler looks for */
export enum SearchType {
    TREE = 'TREE',
    TREE_SEED_POS = 'TREE_SEED_POS',
    STONE = 'STONE',
    FISH = 'FISH',
    VENISON = 'VENISON',
    GRAIN = 'GRAIN',
    SUNFLOWER = 'SUNFLOWER',
    AGAVE = 'AGAVE',
    BEEHIVE = 'BEEHIVE',
    VINE = 'VINE',
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
    /** Work job IDs from jobInfo.xml (filtered from animLists, excludes CHECKIN/IDLE). */
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

// ─────────────────────────────────────────────────────────────
// Carrier Job State
// ─────────────────────────────────────────────────────────────

/** Carrier-specific job data (transport jobs) */
export interface CarrierJobData {
    /** Source building for pickup */
    sourceBuildingId: number;
    /** Destination building for delivery */
    destBuildingId: number;
    /** Material type being transported */
    material: EMaterialType;
    /** Amount to transport */
    amount: number;
    /** Home building ID (tavern) */
    homeId: number;
    /** Carried good type (after pickup) */
    carryingGood: EMaterialType | null;
    /** The TransportJob that owns this delivery's reservation and request lifecycle */
    transportJob: TransportJob;
}

/** Job ID for carrier transport (not XML-defined — carrier phases are inline). */
export const CARRIER_TRANSPORT_JOB_ID = 'CARRIER_TRANSPORT';

/** Carrier transport phase names (indexed by CarrierJobState.taskIndex). */
export enum CarrierPhase {
    GO_TO_SOURCE = 'GO_TO_SOURCE',
    PICKUP = 'PICKUP',
    GO_TO_DEST = 'GO_TO_DEST',
    DROPOFF = 'DROPOFF',
    GO_HOME = 'GO_HOME',
}

/** Carrier job state - for transport jobs */
export interface CarrierJobState {
    type: JobType.CARRIER;
    jobId: string;
    taskIndex: number;
    progress: number;
    data: CarrierJobData;
}

/** Discriminated union of all job state types */
export type JobState = ChoreoJobState | CarrierJobState;

/**
 * Build a CarrierJobState for a transport delivery.
 * The TransportJob owns the reservation and request lifecycle.
 */
export function buildCarrierJob(transportJob: TransportJob): CarrierJobState {
    return {
        type: JobType.CARRIER,
        jobId: CARRIER_TRANSPORT_JOB_ID,
        taskIndex: 0,
        progress: 0,
        data: {
            sourceBuildingId: transportJob.sourceBuilding,
            destBuildingId: transportJob.destBuilding,
            material: transportJob.material,
            amount: transportJob.amount,
            homeId: transportJob.homeBuilding,
            carryingGood: null,
            transportJob,
        },
    };
}

/** Discriminator for JobState union. */
export enum JobType {
    CARRIER = 'carrier',
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

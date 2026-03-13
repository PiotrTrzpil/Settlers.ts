/**
 * Job selection logic — picks the right choreography job for a settler
 * based on available targets and home building state.
 *
 * Uses declarative task-type sets instead of branching if-chains,
 * making selectability criteria easy to read and test in isolation.
 */

import type { Entity } from '../../entity';
import type { BuildingType } from '../../buildings/building-type';
import { raceToRaceId } from '../../data/game-data-access';
import { ChoreoTaskType, type ChoreoJob, type ChoreoNode } from './choreo-types';
import type { JobChoreographyStore } from './job-choreography-store';
import type { SettlerConfig } from './types';

// ─────────────────────────────────────────────────────────────
// Declarative selectability criteria (exported for testing)
// ─────────────────────────────────────────────────────────────

/** First-node task types that require an entity target from findTarget. */
export const ENTITY_TARGET_TASKS: ReadonlySet<ChoreoTaskType> = new Set([
    ChoreoTaskType.GO_TO_TARGET,
    ChoreoTaskType.GO_TO_TARGET_ROUGHLY,
    ChoreoTaskType.GO_TO_POS,
    ChoreoTaskType.GO_TO_POS_ROUGHLY,
    ChoreoTaskType.WORK_ON_ENTITY,
]);

/** Task types that indicate entity work within a job's nodes. */
export const ENTITY_WORK_TASKS: ReadonlySet<ChoreoTaskType> = new Set([
    ChoreoTaskType.WORK_ON_ENTITY,
    ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL,
]);

/** First-node task types for building-internal starts — can begin without entity target when home exists. */
export const BUILDING_INTERNAL_TASKS: ReadonlySet<ChoreoTaskType> = new Set([
    ChoreoTaskType.GO_VIRTUAL,
    ChoreoTaskType.GO_HOME,
    ChoreoTaskType.CHECKIN,
    ChoreoTaskType.WAIT,
    ChoreoTaskType.WAIT_VIRTUAL,
    ChoreoTaskType.WORK_VIRTUAL,
    ChoreoTaskType.GET_GOOD,
    ChoreoTaskType.GET_GOOD_VIRTUAL,
]);

// ─────────────────────────────────────────────────────────────
// Pure helper functions (exported for unit testing)
// ─────────────────────────────────────────────────────────────

/** Check if any node in the job requires entity work. */
export function jobHasEntityWork(job: ChoreoJob): boolean {
    return job.nodes.some(n => ENTITY_WORK_TASKS.has(n.task));
}

/** Return true if this job can be started given the current target state. */
export function isJobSelectable(
    firstNode: ChoreoNode,
    job: ChoreoJob,
    target: { entityId: number; x: number; y: number } | null,
    hasHome: boolean,
    positionTarget: { x: number; y: number } | null
): boolean {
    if (ENTITY_TARGET_TASKS.has(firstNode.task)) {
        if (target) {
            return true;
        }
        // Position-only target: only pick jobs without WORK_ON_ENTITY nodes
        // (e.g. forester PLANT job, not farmer HARVEST which needs an entity to work on)
        return positionTarget !== null && !jobHasEntityWork(job);
    }
    // Self-searching jobs (SEARCH node first) don't need external target
    if (firstNode.task === ChoreoTaskType.SEARCH) {
        return true;
    }
    // Building-internal jobs require a home for position resolution
    return hasHome && BUILDING_INTERNAL_TASKS.has(firstNode.task);
}

// ─────────────────────────────────────────────────────────────
// JobSelector class
// ─────────────────────────────────────────────────────────────

export class JobSelector {
    constructor(private readonly choreographyStore: JobChoreographyStore) {}

    /**
     * Select the best choreo job for a settler based on target availability.
     *
     * Iterates config.jobs (XML job IDs like 'JOB_WOODCUTTER_WORK') and picks
     * the first job whose first node matches the available target type:
     * - Entity-target jobs (GO_TO_TARGET, etc.) need an external entity or position target.
     * - Self-searching jobs (SEARCH) can start without one.
     */
    selectJob(
        settler: Entity,
        config: SettlerConfig,
        target: { entityId: number; x: number; y: number } | null,
        homeBuilding: Entity | null,
        positionTarget?: { x: number; y: number } | null
    ): ChoreoJob | null {
        const raceId = raceToRaceId(settler.race);

        // For settlers with building-sourced jobs (e.g. miners), filter to the assigned building's jobs
        const jobs = (homeBuilding && config.buildingJobs?.get(homeBuilding.subType as BuildingType)) ?? config.jobs;

        for (const jobId of jobs) {
            const job = this.choreographyStore.getJob(raceId, jobId);
            if (!job?.nodes.length) {
                continue;
            }
            if (isJobSelectable(job.nodes[0]!, job, target, homeBuilding !== null, positionTarget ?? null)) {
                return job;
            }
        }

        return null;
    }
}

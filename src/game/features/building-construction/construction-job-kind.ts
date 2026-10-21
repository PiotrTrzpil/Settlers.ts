/**
 * The `Construction` job kind (docs/designs/job-ownership.md, "Construction migration").
 *
 * One job = one unit of construction work for a site (ref = siteId): walk to `workPos`, then
 * DIG_TILE (digger, levels `tileIndex`) or BUILD_STEP (builder). A carrier recruited for the job
 * runs the recruit segment first (`params.recruit`, via `RecruitSegments.prefix`) and the job is
 * reserved until it ends. Params are plain data, so the job is saved and rebuilt on load.
 *
 * Outcomes are routed to the {@link ConstructionJobOwner} (the demand system): completion chains
 * the next DIG/BUILD job from inside the callback; failure, preemption and unit removal release
 * the worker's demand and its tile reservation.
 */

import {
    ChoreoTaskType,
    JobKind,
    choreo,
    type JobBuild,
    type JobKindHandler,
    type JobSpec,
} from '../../systems/choreo';
import type { RecruitSegment, RecruitSegments } from '../recruit';
import type { ConstructionWorkerRole } from './construction-worker-demands';
import { createLogger } from '@/utilities/logger';

const log = createLogger('ConstructionJobKind');

/** Params of a Construction job — everything `build` needs; JSON data only. */
export type ConstructionJobParams = {
    readonly siteId: number;
    readonly role: ConstructionWorkerRole;
    /** Unleveled tile the digger levels (its demand's reservation); null for builders. */
    readonly tileIndex: number | null;
    /** Where the worker digs / builds. */
    readonly workPos: { readonly x: number; readonly y: number };
    /** Carrier → digger / builder transform before the work; null for an existing specialist. */
    readonly recruit: RecruitSegment | null;
};

/** The demand-side callbacks of the Construction kind (implemented by ConstructionSiteDemandSystem). */
export interface ConstructionJobOwner {
    /** True when the unit's demand on `siteId` is bound to it (restore: rebound from its commitment). */
    isBound(unitId: number, siteId: number): boolean;
    /** The unit's job completed — push the next DIG/BUILD job, or retire the demand. */
    onWorkerJobCompleted(unitId: number, siteId: number): void;
    /** The unit's job failed / was preempted / the unit died — release its demand (tile included). */
    onWorkerJobEnded(unitId: number, siteId: number): void;
}

/** JobSpec of a Construction job; reserved while it carries a recruit segment (Decision 4). */
export function constructionJobSpec(params: ConstructionJobParams): JobSpec<ConstructionJobParams> {
    return { kind: JobKind.Construction, ref: params.siteId, params, reserved: params.recruit !== null };
}

/** Job id (display / events / timeline) — the legacy ids are kept. */
function constructionJobId(params: ConstructionJobParams): string {
    if (params.role === 'digger') {
        return params.recruit ? 'RECRUIT_DIGGER' : 'DIG_TILE';
    }
    return params.recruit ? 'RECRUIT_BUILDER' : 'BUILD_STEP';
}

/** The work part of the job: goTo(workPos) + DIG_TILE / BUILD_STEP with node args. */
function buildWork(params: ConstructionJobParams): JobBuild {
    const builder = choreo(constructionJobId(params), JobKind.Construction).goTo(params.workPos);
    if (params.role === 'digger') {
        const args = { task: 'digTile', siteId: params.siteId, tileIndex: params.tileIndex! } as const;
        return builder.addNode(ChoreoTaskType.DIG_TILE, { args }).toJobBuild();
    }
    const args = { task: 'buildStep', siteId: params.siteId } as const;
    return builder.addNode(ChoreoTaskType.BUILD_STEP, { args }).toJobBuild();
}

export function createConstructionJobKind(
    segments: RecruitSegments,
    owner: ConstructionJobOwner
): JobKindHandler<ConstructionJobParams> {
    return {
        kind: JobKind.Construction,
        persist: true,
        // The demand was rebound from the commitment in onRestoreComplete — unless the site is gone
        // or no longer needs this role (e.g. completed while rebuilding after restore).
        restorable: (unitId, _ref, params) => owner.isBound(unitId, params.siteId),
        build: (_unitId, params) => {
            const work = buildWork(params);
            return params.recruit ? segments.prefix(params.recruit, work) : work;
        },
        onCompleted: (unitId, siteId) => owner.onWorkerJobCompleted(unitId, siteId),
        onFailed: (unitId, siteId, params, info) => {
            log.debug(`${params.role} ${unitId} at site ${siteId} ended early (${info.reason})`);
            owner.onWorkerJobEnded(unitId, siteId);
        },
        onUnitRemoved: (unitId, siteId) => owner.onWorkerJobEnded(unitId, siteId),
    };
}

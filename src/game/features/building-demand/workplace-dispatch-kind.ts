/**
 * The `WorkplaceDispatch` job kind (docs/designs/job-ownership.md, "Workplace-dispatch migration").
 *
 * A building that needs a worker dispatches one unit: ref = building id, params
 * `{ buildingId, recruit }`. Nodes = [recruit segment (walk to the tool pile + TRANSFORM_*)] +
 * goToDoor + ENTER_BUILDING. A recruiting carrier is reserved for the whole job; an idle specialist
 * walking in directly is not. The recruit source reservation belongs to the TRANSFORM_* node
 * hooks — this handler never releases anything itself.
 */

import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import { JobKind, choreo, type JobKindHandler, type JobSpec } from '../../systems/choreo';
import type { RecruitSegment, RecruitSegments } from '../recruit';

/** Params of a WorkplaceDispatch job: the building to enter, and the transform on the way (if any). */
export type WorkplaceDispatchParams = {
    readonly buildingId: number;
    readonly recruit: RecruitSegment | null;
};

/** The JobSpec dispatching a unit to `buildingId` (recruiting on the way when `recruit` is set). */
export function workplaceDispatchSpec(
    buildingId: number,
    recruit: RecruitSegment | null
): JobSpec<WorkplaceDispatchParams> {
    return {
        kind: JobKind.WorkplaceDispatch,
        ref: buildingId,
        params: { buildingId, recruit },
        reserved: recruit !== null,
    };
}

/** Domain side of the handler — the building's worker demand. */
export interface WorkplaceDispatchOwner {
    /** The unit entered the building: the demand is fulfilled. */
    dispatchCompleted(buildingId: number, unitId: number): void;
    /** The job ended without filling the building (failed, preempted, unit removed): re-open the demand. */
    dispatchEnded(buildingId: number, unitId: number): void;
}

export interface WorkplaceDispatchKindDeps {
    gameState: GameState;
    terrain: TerrainData;
    segments: RecruitSegments;
    owner: WorkplaceDispatchOwner;
}

export function createWorkplaceDispatchKind(deps: WorkplaceDispatchKindDeps): JobKindHandler<WorkplaceDispatchParams> {
    const { gameState, terrain, segments, owner } = deps;
    return {
        kind: JobKind.WorkplaceDispatch,
        persist: true,
        // No `restorable`: building removal cancels the job, so a saved job's building always exists
        // (BuildingDemandSystem.restoreCommittedDemands asserts it).
        build: (_unitId, { buildingId, recruit }) => {
            const door = choreo('WORKER_DISPATCH', JobKind.WorkplaceDispatch)
                .goToDoorAndEnter(buildingId, { gameState, terrain })
                .toJobBuild();
            return recruit ? segments.prefix(recruit, door) : door;
        },
        onCompleted: (unitId, buildingId) => owner.dispatchCompleted(buildingId, unitId),
        onFailed: (unitId, buildingId) => owner.dispatchEnded(buildingId, unitId),
        onUnitRemoved: (unitId, buildingId) => owner.dispatchEnded(buildingId, unitId),
    };
}

/**
 * The `Work` job kind — XML / registered choreographies (woodcutter, farmer, pioneer, …).
 *
 * Owned by settler-tasks itself. Jobs are started by WorkerAutonomy's idle search
 * (JobRunner.startJob), never through JobService.assign; the handler exists so Work jobs save and
 * restore through the same `{ kind, params, nodeIndex }` path as every other kind. Its outcome
 * callbacks are no-ops: an idle worker simply searches again.
 *
 * ref = the unit's home building id, or -1. params = `{ choreoJobId }` (XML job id).
 */

import { JobKind, type ChoreoJobOwner, type JobBuild, type JobKindHandler } from '../../systems/choreo';
import type { GameState } from '../../game-state';
import { raceToRaceId } from '../../data/game-data-access';
import type { JobChoreographyStore } from './job-choreography-store';

/** Params of a Work job: the XML (or registered code-defined) choreography id. */
export type WorkJobParams = { readonly choreoJobId: string };

/** Owner identity of a Work job state. */
export function workJobOwner(choreoJobId: string, ref: number): ChoreoJobOwner {
    const params: WorkJobParams = { choreoJobId };
    return { kind: JobKind.Work, ref, params };
}

/** The Work kind handler (registered by SettlerTaskSystem). */
export function createWorkJobKind(gameState: GameState, store: JobChoreographyStore): JobKindHandler<WorkJobParams> {
    const findJob = (unitId: number, choreoJobId: string) => {
        const unit = gameState.getEntityOrThrow(unitId, 'Work job unit');
        return store.getJob(raceToRaceId(unit.race), choreoJobId);
    };
    return {
        kind: JobKind.Work,
        persist: true,
        restorable: (unitId, _ref, params) => findJob(unitId, params.choreoJobId) !== undefined,
        build(unitId, params): JobBuild {
            const job = findJob(unitId, params.choreoJobId);
            if (!job) {
                throw new Error(`Work job '${params.choreoJobId}' not found for unit ${unitId}`);
            }
            return { jobId: job.id, nodes: job.nodes };
        },
        onCompleted: () => {},
        onFailed: () => {},
        onUnitRemoved: () => {},
    };
}

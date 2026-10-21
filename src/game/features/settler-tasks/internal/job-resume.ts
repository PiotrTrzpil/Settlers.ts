/**
 * Job resume after load — restored owned jobs are rebuilt and resumed in the final restore pass
 * (`onRestoreResume`), after every owner rebuilt its domain state from commitments.
 *
 * Resume semantics (docs/designs/job-ownership.md, "Resume semantics"): build the nodes from the
 * saved params, snap the saved index back to a safe node that does not cross a completed
 * irreversible node, let the owner adjust it (`resumeIndex`), then run the `onRestore` hooks of
 * the remaining nodes. Any refusal abandons the job: its owner gets onFailed('restoreFailed').
 */

import { createLogger } from '@/utilities/logger';
import type { EventBus } from '../../../event-bus';
import {
    ChoreoTaskType,
    createChoreoJobState,
    type ChoreoNode,
    type ChoreoSystem,
    type JobBuild,
    type JobKindHandler,
} from '../../../systems/choreo';
import type { UnitCommitment, UnitCommitmentQuery, UnitCommitmentWriter } from '../../../systems/unit-commitment';
import type { SerializedJob } from '../../../state/persistence-types';
import { SettlerState, type JobState } from '../types';
import type { UnitRuntimeStore } from '../unit-runtime';
import type { JobOwnerRegistry } from './job-owners';
import { emitJobAborted } from './job-events';

const log = createLogger('JobResume');

/**
 * Movement / search task types — safe points to resume a job from: re-starting the node naturally
 * re-acquires any runtime state (animation, path, target).
 */
const SAFE_RESUME_TASKS: ReadonlySet<ChoreoTaskType> = new Set([
    ChoreoTaskType.GO_TO_TARGET,
    ChoreoTaskType.GO_TO_TARGET_ROUGHLY,
    ChoreoTaskType.GO_TO_POS,
    ChoreoTaskType.GO_TO_POS_ROUGHLY,
    ChoreoTaskType.GO_TO_SOURCE_PILE,
    ChoreoTaskType.GO_TO_DESTINATION_PILE,
    ChoreoTaskType.GO_HOME,
    ChoreoTaskType.SEARCH,
    ChoreoTaskType.TRANSPORT_GO_TO_SOURCE,
    ChoreoTaskType.TRANSPORT_GO_TO_DEST,
]);

/**
 * Generalised safe-node snapping. Nodes `[0, min(savedIndex, n))` completed before the save;
 * `w` = the index after the last completed irreversible node (0 if none). Resume at the nearest
 * safe node in `[w, min(savedIndex, n - 1)]`, searching backwards; none ⇒ `w`. A job saved after
 * its last node (completion pending) whose last node is irreversible resumes at `n` and completes.
 */
export function snapResumeIndex(nodes: readonly ChoreoNode[], savedIndex: number, choreoSystem: ChoreoSystem): number {
    const completed = Math.min(savedIndex, nodes.length);
    let floor = 0;
    for (let k = completed - 1; k >= 0; k--) {
        const hooks = choreoSystem.hooksFor(nodes[k]!.task);
        if (hooks?.irreversible) {
            floor = k + 1;
            break;
        }
    }
    for (let k = Math.min(savedIndex, nodes.length - 1); k >= floor; k--) {
        if (SAFE_RESUME_TASKS.has(nodes[k]!.task)) {
            return k;
        }
    }
    return floor;
}

/** Restored jobs waiting for `onRestoreResume`, keyed by unit id. Their commitments are already set. */
export class PendingJobResumes {
    private readonly jobs = new Map<number, SerializedJob>();

    add(unitId: number, job: SerializedJob): void {
        this.jobs.set(unitId, job);
    }

    /** The unit's restored job awaiting resume. Nullable by design: most units have none. */
    get(unitId: number): SerializedJob | undefined {
        return this.jobs.get(unitId);
    }

    /** Remove and return all pending jobs in ascending unit-id order (deterministic resume). */
    drain(): [number, SerializedJob][] {
        const entries = [...this.jobs].sort(([a], [b]) => a - b);
        this.jobs.clear();
        return entries;
    }
}

export interface JobResumeDeps {
    eventBus: EventBus;
    choreoSystem: ChoreoSystem;
    runtimes: UnitRuntimeStore;
    owners: JobOwnerRegistry;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
}

/** Build and resume every pending restored job (final restore pass). */
export function resumePendingJobs(deps: JobResumeDeps, pending: PendingJobResumes): void {
    for (const [unitId, saved] of pending.drain()) {
        const commitment = deps.commitments.get(unitId);
        if (!commitment || commitment.owner !== saved.kind || !commitment.hasJob) {
            throw new Error(`Restored job '${saved.kind}' of unit ${unitId} lost its commitment before resume`);
        }
        resumeJob(deps, unitId, saved, commitment);
    }
}

function resumeJob(deps: JobResumeDeps, unitId: number, saved: SerializedJob, commitment: UnitCommitment): void {
    const handler = deps.owners.kind(saved.kind);
    const { ref } = commitment;
    if (handler.restorable && !handler.restorable(unitId, ref, saved.params)) {
        abandon(deps, unitId, saved, ref, handler, 'not restorable');
        return;
    }
    const build = handler.build(unitId, saved.params);
    const snapped = snapResumeIndex(build.nodes, saved.nodeIndex, deps.choreoSystem);
    const index = handler.resumeIndex ? handler.resumeIndex(unitId, ref, saved.params, snapped, build.nodes) : snapped;
    if (index === null) {
        abandon(deps, unitId, saved, ref, handler, 'resumeIndex refused');
        return;
    }
    if (!restoreNodeHooks(deps.choreoSystem, unitId, build.nodes, index)) {
        abandon(deps, unitId, saved, ref, handler, 'node onRestore refused');
        return;
    }

    const runtime = deps.runtimes.getOrCreate(unitId);
    runtime.job = restoredJobState(saved, ref, build, index);
    runtime.state = SettlerState.WORKING;
    runtime.moveTask = null;
    log.debug(
        `Resumed ${saved.kind} job ${build.jobId} for unit ${unitId} at node ${index} (saved ${saved.nodeIndex})`
    );
}

/** Job state from the fresh build, at the resume index, with the saved targets overlaid. */
function restoredJobState(saved: SerializedJob, ref: number, build: JobBuild, index: number): JobState {
    const job = createChoreoJobState(build.jobId, build.nodes, { kind: saved.kind, ref, params: saved.params });
    job.nodeIndex = index;
    // eslint-disable-next-line no-restricted-syntax -- JobBuild targets are optional by design; absent ⇒ none
    job.targetId = build.targetId ?? null;
    // eslint-disable-next-line no-restricted-syntax -- JobBuild targets are optional by design; absent ⇒ none
    job.targetPos = build.targetPos ?? null;
    // eslint-disable-next-line no-restricted-syntax -- JobBuild targets are optional by design; absent ⇒ none
    job.carryingGood = build.carryingGood ?? null;
    if (saved.targetId !== undefined) {
        job.targetId = saved.targetId;
    }
    if (saved.targetPos !== undefined) {
        job.targetPos = saved.targetPos;
    }
    if (saved.approachPos !== undefined) {
        job.approachPos = saved.approachPos;
    }
    return job;
}

/**
 * Run `onRestore` for every node from `index` on. On a refusal, the nodes that already restored
 * get `onAbort` (so a re-reserved source is released again) and false is returned.
 */
function restoreNodeHooks(
    choreoSystem: ChoreoSystem,
    unitId: number,
    nodes: readonly ChoreoNode[],
    index: number
): boolean {
    for (let i = index; i < nodes.length; i++) {
        const hooks = choreoSystem.hooksFor(nodes[i]!.task);
        if (hooks?.onRestore && !hooks.onRestore(unitId, nodes[i]!)) {
            for (let k = index; k < i; k++) {
                const restored = choreoSystem.hooksFor(nodes[k]!.task);
                if (restored?.onRestore && restored.onAbort) {
                    restored.onAbort(unitId, nodes[k]!);
                }
            }
            return false;
        }
    }
    return true;
}

/** The saved job cannot resume: clear its commitment, INTERRUPTED, owner.onFailed('restoreFailed'), notify. */
function abandon(
    deps: JobResumeDeps,
    unitId: number,
    saved: SerializedJob,
    ref: number,
    handler: JobKindHandler,
    why: string
): void {
    log.warn(`Restored ${saved.kind} job of unit ${unitId} (ref ${ref}) cannot resume: ${why}`);
    deps.commitmentWriter.clear(unitId);
    deps.runtimes.getOrCreate(unitId).state = SettlerState.INTERRUPTED;
    handler.onFailed(unitId, ref, saved.params, {
        reason: 'restoreFailed',
        nodeIndex: saved.nodeIndex,
        failedStep: 'restore',
    });
    emitJobAborted(deps.eventBus, unitId, { jobId: '', kind: saved.kind, ref }, 'restoreFailed');
}

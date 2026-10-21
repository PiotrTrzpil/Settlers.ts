/**
 * JobService — the job-ownership API other features use (exported as `SettlerTaskExports.jobs`).
 *
 * Owners register their JobKind handler / hold owner once in `create()`, then commit units only
 * through `assign` / `cancel` / `hold` / `releaseHold` (Invariant 3). Outcomes come back as direct
 * handler calls (Invariant 5); `settler:task*` events are notifications.
 *
 * See docs/designs/job-ownership.md ("Shared Contracts", "Core implementation notes").
 */

import type { Tile } from '../../entity';
import type { GameState } from '../../game-state';
import { createChoreoJobState, type JobKindHandler, type JobParams, type JobSpec } from '../../systems/choreo';
import type { CommitmentOwner, UnitCommitmentQuery, UnitCommitmentWriter } from '../../systems/unit-commitment';
import type { UnitRuntimeStore } from './unit-runtime';
import type { JobRunner } from './job-runner';
import type { JobOutcomes } from './internal/job-outcomes';
import type { HoldOwnerHandler, JobOwnerRegistry } from './internal/job-owners';
import type { PendingJobResumes } from './internal/job-resume';

export type { HoldOwnerHandler } from './internal/job-owners';

export interface JobAssignOptions {
    /** Start walking here right away (pathfinding failure ⇒ `assign` returns false). */
    readonly moveTo?: Tile;
}

export interface JobService {
    /** Register the one owner of a JobKind (Invariant 4). Call in the owning feature's `create()`. */
    registerKind<P extends JobParams>(handler: JobKindHandler<P>): void;
    /**
     * Register the owner of holds / move commitments for `owner` (siege, garrison). A JobKind that
     * also holds units (Garrison) registers both its JobKind handler and a hold owner.
     */
    registerHoldOwner(handler: HoldOwnerHandler): void;
    /**
     * Build the job via the kind handler and start it; preempts whatever owns the unit now (a job's
     * owner gets onFailed 'preempted', a hold owner onPreempted). False when `moveTo` is unreachable.
     */
    assign<P extends JobParams>(unitId: number, spec: JobSpec<P>, opts?: JobAssignOptions): boolean;
    /**
     * Owner-initiated stop of the unit's job / move / hold. Runs teardown + node abort hooks; does NOT
     * call the owner back (Invariant 8). No-op when `owner` does not own the unit (already ended).
     */
    cancel(unitId: number, owner: CommitmentOwner): void;
    /**
     * Commit the unit to `owner` without a job (garrisoned, siege). Preempts another owner like
     * `assign`; on a hold the owner already has, updates ref / reserved (a running siege move keeps going).
     */
    hold(unitId: number, owner: CommitmentOwner, ref: number, reserved: boolean): void;
    /**
     * End `owner`'s hold. No-op when another owner (or nobody) owns the unit; throws when `owner`'s
     * commitment runs a job (use `cancel`). A running move continues as an unreserved player move.
     */
    releaseHold(unitId: number, owner: CommitmentOwner): void;
    /**
     * Params of the unit's job — running, or restored and not resumed yet (so owners can rebuild their
     * domain state from commitments + params in `onRestoreComplete`). Nullable by design: undefined
     * when the unit runs no owned job.
     */
    paramsOf(unitId: number): JobParams | undefined;
    readonly commitments: UnitCommitmentQuery;
}

export interface JobServiceConfig {
    gameState: GameState;
    runtimes: UnitRuntimeStore;
    owners: JobOwnerRegistry;
    jobRunner: JobRunner;
    outcomes: JobOutcomes;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
    pendingResumes: PendingJobResumes;
}

export class JobServiceImpl implements JobService {
    readonly commitments: UnitCommitmentQuery;
    private readonly gameState: GameState;
    private readonly runtimes: UnitRuntimeStore;
    private readonly owners: JobOwnerRegistry;
    private readonly jobRunner: JobRunner;
    private readonly outcomes: JobOutcomes;
    private readonly writer: UnitCommitmentWriter;
    private readonly pendingResumes: PendingJobResumes;

    constructor(cfg: JobServiceConfig) {
        this.gameState = cfg.gameState;
        this.runtimes = cfg.runtimes;
        this.owners = cfg.owners;
        this.jobRunner = cfg.jobRunner;
        this.outcomes = cfg.outcomes;
        this.commitments = cfg.commitments;
        this.writer = cfg.commitmentWriter;
        this.pendingResumes = cfg.pendingResumes;
    }

    registerKind<P extends JobParams>(handler: JobKindHandler<P>): void {
        this.owners.registerKind(handler);
    }

    registerHoldOwner(handler: HoldOwnerHandler): void {
        this.owners.registerHoldOwner(handler);
    }

    /** Startup assertion (Invariant 4) — called by GameServices after all features loaded. */
    assertAllRegistered(): void {
        this.owners.assertAllRegistered();
    }

    assign<P extends JobParams>(unitId: number, spec: JobSpec<P>, opts?: JobAssignOptions): boolean {
        const build = this.owners.kind(spec.kind).build(unitId, spec.params);
        const job = createChoreoJobState(build.jobId, build.nodes, {
            kind: spec.kind,
            ref: spec.ref,
            params: spec.params,
        });
        // eslint-disable-next-line no-restricted-syntax -- JobBuild targets are optional by design; absent ⇒ none
        job.targetId = build.targetId ?? null;
        // eslint-disable-next-line no-restricted-syntax -- JobBuild targets are optional by design; absent ⇒ none
        job.targetPos = build.targetPos ?? null;
        // eslint-disable-next-line no-restricted-syntax -- JobBuild targets are optional by design; absent ⇒ none
        job.carryingGood = build.carryingGood ?? null;
        return this.jobRunner.startAssignedJob(unitId, job, spec.reserved, opts?.moveTo);
    }

    cancel(unitId: number, owner: CommitmentOwner): void {
        this.outcomes.cancel(unitId, owner);
    }

    hold(unitId: number, owner: CommitmentOwner, ref: number, reserved: boolean): void {
        this.owners.holdOwner(owner);
        const unit = this.gameState.getEntityOrThrow(unitId, `unit held by '${owner}'`);
        const current = this.commitments.get(unitId);
        if (current && current.owner === owner) {
            if (current.hasJob) {
                throw new Error(`hold: unit ${unitId} runs a '${owner}' job — cancel it before holding`);
            }
            this.writer.set(unitId, { owner, ref, reserved, hasJob: false });
            return;
        }
        this.outcomes.takeOver(unit, this.runtimes.getOrCreate(unitId), owner);
        this.writer.set(unitId, { owner, ref, reserved, hasJob: false });
    }

    paramsOf(unitId: number): JobParams | undefined {
        const commitment = this.commitments.get(unitId);
        if (!commitment || !commitment.hasJob) {
            return undefined;
        }
        // A restored, not yet resumed job: the unit may have no runtime yet (e.g. a carrier without a home).
        const pending = this.pendingResumes.get(unitId);
        if (pending) {
            return pending.params;
        }
        return this.runtimes.get(unitId)!.job!.params;
    }

    releaseHold(unitId: number, owner: CommitmentOwner): void {
        const current = this.commitments.get(unitId);
        if (!current || current.owner !== owner) {
            return;
        }
        if (current.hasJob) {
            throw new Error(`releaseHold: unit ${unitId} runs a '${owner}' job — use cancel`);
        }
        this.writer.clear(unitId);
        const runtime = this.runtimes.get(unitId);
        if (runtime && runtime.moveTask) {
            this.writer.set(unitId, { owner: 'player-move', ref: -1, reserved: false, hasJob: false });
        }
    }
}

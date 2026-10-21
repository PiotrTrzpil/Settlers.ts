/**
 * Job ownership contract — domain-free.
 *
 * Every job has exactly one owner: a {@link JobKindHandler} registered once per {@link JobKind}
 * with the job runtime (settler-tasks' JobService). A dispatcher hands the runtime a plain
 * {@link JobSpec}; the handler turns its JSON `params` into nodes ({@link JobBuild}) and is called
 * back directly on completion, failure and unit removal. Saves store `{ kind, params, nodeIndex }`
 * and rebuild through the same `build(params)` on load.
 *
 * See docs/designs/job-ownership.md ("Shared Contracts").
 */

import type { EMaterialType } from '../../economy';
import type { Tile } from '@/game/core/coordinates';
import type { ChoreoNode } from './types';

/** One owner per kind. Each kind's handler is registered once by its owning feature. */
export enum JobKind {
    /** XML / registered choreographies (autonomous workers) — owner: settler-tasks. ref = home building id or -1. */
    Work = 'work',
    /** Carrier material transport — owner: logistics. ref = TransportJobRecord.id. */
    Transport = 'transport',
    /** Dispatch specialist or recruit carrier into a workplace — owner: building-demand. ref = buildingId. */
    WorkplaceDispatch = 'workplace-dispatch',
    /** Construction digger/builder work (optionally with a recruit prefix) — owner: building-construction. ref = siteId. */
    Construction = 'construction',
    /** Enter tower / garrison commit — owner: tower-garrison. ref = towerId. */
    Garrison = 'garrison',
    /** Barracks training transform — owner: barracks. ref = barracksId. */
    Barracks = 'barracks',
    /** Player-queued and direct transforms — owner: recruit. ref = 0. */
    Recruit = 'recruit',
}

/** Plain, JSON-serializable param value. */
export type JobParamValue = number | string | boolean | null | { readonly x: number; readonly y: number };

/** Plain, JSON-serializable params. Each kind narrows it with its own interface. No closures, ever. */
export type JobParams = Readonly<Record<string, JobParamValue | Readonly<Record<string, JobParamValue>>>>;

/** What a dispatcher hands to `JobService.assign`. */
export interface JobSpec<P extends JobParams = JobParams> {
    readonly kind: JobKind;
    /** Owner's own key (record / demand / tower id) — see the per-kind table in the design doc. */
    readonly ref: number;
    readonly params: P;
    /** Player move commands are rejected while true. */
    readonly reserved: boolean;
}

/** Output of `build()`: a pure function of params + current world state (no captured closures). */
export interface JobBuild {
    /** Display / XML id of the job ("JOB_WOODCUTTER_WORK", "DIG_TILE") — events, debug, timeline. */
    readonly jobId: string;
    readonly nodes: ChoreoNode[];
    readonly targetId?: number | null;
    readonly targetPos?: Tile | null;
    readonly carryingGood?: EMaterialType | null;
}

export type JobFailureReason =
    /** A node returned FAILED / an executor threw / the runtime ended the job (home removed, dismissed, …). */
    | 'failed'
    /** Another assign / player move / hold took the unit. */
    | 'preempted'
    /** Resume after load was impossible. */
    | 'restoreFailed';

export interface JobFailureInfo {
    readonly reason: JobFailureReason;
    /** Node index the job was at (for restoreFailed: the saved raw index). */
    readonly nodeIndex: number;
    /** Task type name of that node ('restore' when the job was never rebuilt). */
    readonly failedStep: string;
}

/**
 * Owner of one {@link JobKind}. Registered once via `JobService.registerKind` in the owning
 * feature's `create()`; settler-tasks never imports owner features (Rule 2.3).
 */
export interface JobKindHandler<P extends JobParams = JobParams> {
    readonly kind: JobKind;
    /** Persist this kind's jobs (false only for kinds whose domain state is not persisted — they load idle). */
    readonly persist: boolean;
    /** Build the job's nodes from params and the current world. Must not capture closures. */
    build(unitId: number, params: P): JobBuild;
    /** Commitment is already cleared; calling `JobService.assign()` for the same unit here is allowed. */
    onCompleted(unitId: number, ref: number, params: P): void;
    /** Commitment cleared, runtime torn down, unit already INTERRUPTED; may reassign. */
    onFailed(unitId: number, ref: number, params: P, info: JobFailureInfo): void;
    /** Entity is already gone from GameState; only domain bookkeeping is allowed. */
    onUnitRemoved(unitId: number, ref: number, params: P): void;
    /**
     * Restore, before `build`: false ⇒ the saved job cannot be rebuilt in this world (its building /
     * record / site is gone) → `onFailed` with reason 'restoreFailed'. Default: true.
     */
    restorable?(unitId: number, ref: number, params: P): boolean;
    /**
     * Restore: called with the generically snapped index (see "Resume semantics"). Return the index to
     * resume at, or null to abandon (→ `onFailed` reason 'restoreFailed'). Default: identity.
     */
    resumeIndex?(
        unitId: number,
        ref: number,
        params: P,
        snappedIndex: number,
        nodes: readonly ChoreoNode[]
    ): number | null;
}

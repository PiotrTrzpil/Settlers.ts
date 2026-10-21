/**
 * JobOwnerRegistry — who owns each JobKind and each hold / move commitment owner.
 *
 * Filled by features in `create()` through JobService.registerKind / registerHoldOwner
 * (registration over import, Rule 2.3). Lookups throw for unregistered owners: a job or a
 * hold can only exist for an owner that is called back on its outcome.
 */

import { JobKind, type JobKindHandler, type JobParams } from '../../../systems/choreo';
import type { CommitmentOwner } from '../../../systems/unit-commitment';

/** Owner of commitments that run no job: holds (garrisoned, siege) and move commitments. */
export interface HoldOwnerHandler {
    readonly owner: CommitmentOwner;
    /** False ⇒ the hold is dropped on save and the unit loads idle (siege). */
    readonly persist: boolean;
    /** The held unit's entity is already gone; commitment already cleared. Domain bookkeeping only. */
    onUnitRemoved(unitId: number, ref: number): void;
    /** Another owner took the unit (job assign, hold, player move); commitment already replaced. */
    onPreempted(unitId: number, ref: number): void;
}

/**
 * TRANSITIONAL (deleted in Cleanup, which then asserts every JobKind): kinds that may still run
 * only as legacy `choreo().build()` jobs and therefore need no handler at startup. A kind that is
 * assigned through JobService always needs its handler — `kind()` throws otherwise.
 */
const TRANSITIONAL_UNOWNED_KINDS: ReadonlySet<JobKind> = new Set([
    JobKind.Transport,
    JobKind.WorkplaceDispatch,
    JobKind.Construction,
    JobKind.Garrison,
    JobKind.Barracks,
    JobKind.Recruit,
]);

export class JobOwnerRegistry {
    private readonly kinds = new Map<JobKind, JobKindHandler>();
    private readonly holdOwners = new Map<CommitmentOwner, HoldOwnerHandler>();

    registerKind<P extends JobParams>(handler: JobKindHandler<P>): void {
        if (this.kinds.has(handler.kind)) {
            throw new Error(`JobKind handler already registered for kind '${handler.kind}'`);
        }
        this.kinds.set(handler.kind, handler as unknown as JobKindHandler);
    }

    registerHoldOwner(handler: HoldOwnerHandler): void {
        if (this.holdOwners.has(handler.owner)) {
            throw new Error(`Hold owner already registered for '${handler.owner}'`);
        }
        this.holdOwners.set(handler.owner, handler);
    }

    /** The handler that owns `kind`'s jobs. Throws when none is registered. */
    kind(kind: JobKind): JobKindHandler {
        const handler = this.kinds.get(kind);
        if (!handler) {
            throw new Error(
                `No JobKind handler registered for kind '${kind}'. Registered: [${[...this.kinds.keys()].join(', ')}]`
            );
        }
        return handler;
    }

    /** The handler that owns `owner`'s holds / move commitments. Throws when none is registered. */
    holdOwner(owner: CommitmentOwner): HoldOwnerHandler {
        const handler = this.holdOwners.get(owner);
        if (!handler) {
            throw new Error(
                `No hold owner registered for '${owner}'. Registered: [${[...this.holdOwners.keys()].join(', ')}]`
            );
        }
        return handler;
    }

    /** Whether a job commitment of `kind` is saved (the kind handler's `persist`). */
    persistsJobs(kind: JobKind): boolean {
        return this.kind(kind).persist;
    }

    /** Whether a hold / move commitment of `owner` is saved (the hold owner's `persist`). */
    persistsHolds(owner: CommitmentOwner): boolean {
        return this.holdOwner(owner).persist;
    }

    /** Startup assertion (Invariant 4): every JobKind not still legacy-only has a handler. */
    assertAllRegistered(): void {
        const missing = Object.values(JobKind).filter(
            kind => !this.kinds.has(kind) && !TRANSITIONAL_UNOWNED_KINDS.has(kind)
        );
        if (missing.length > 0) {
            throw new Error(`No JobKind handler registered for kinds: ${missing.join(', ')}`);
        }
    }
}

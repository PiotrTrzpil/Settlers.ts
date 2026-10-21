/**
 * UnitCommitments — the one record of who owns a unit right now.
 *
 * Kernel store created by GameServices. A unit has at most one commitment; a unit is idle
 * if and only if it has none (Invariant 1 of docs/designs/job-ownership.md). A commitment
 * either runs a job (`hasJob`), a move task (owner 'player-move' / 'siege'), or is a hold —
 * owned, but nothing runs (garrisoned unit, siege participant).
 *
 * Read side ({@link UnitCommitmentQuery}) is in every FeatureContext as `ctx.unitCommitments`.
 * Write side ({@link UnitCommitmentWriter}) is claimed exactly once, by settler-tasks' JobService
 * (Invariant 3) — owners change commitments only through `assign` / `cancel` / `hold` / `releaseHold`.
 *
 * TRANSITIONAL (Cleanup removes): `isReserved` / `isIdle` also OR the legacy
 * UnitReservationRegistry, so units reserved by not-yet-migrated owners stay protected.
 */

import type { JobKind } from './choreo/job-kind';
import type { UnitReservationRegistry } from './unit-reservation';

/** Who owns a committed unit: a job kind, a player move, or the siege system. */
export type CommitmentOwner = JobKind | 'player-move' | 'siege';

export interface UnitCommitment {
    readonly owner: CommitmentOwner;
    /** Owner's key (record / demand / tower / building id); -1 when the owner has none. */
    readonly ref: number;
    /** Player move commands are rejected while true. */
    readonly reserved: boolean;
    /** False for holds and move commitments: owned, but no job runs. */
    readonly hasJob: boolean;
}

/** Narrow reservation check (move commands, combat). */
export interface UnitReservationQuery {
    isReserved(unitId: number): boolean;
}

/** Read side — in FeatureContext as `ctx.unitCommitments` (combat, siege, carriers, AI, debug). */
export interface UnitCommitmentQuery extends UnitReservationQuery {
    /** The unit's commitment. Nullable by design: undefined ⇔ idle. */
    get(unitId: number): UnitCommitment | undefined;
    isIdle(unitId: number): boolean;
    /** Ascending unit ids. `ref` omitted ⇒ all units of that owner. */
    unitsOwnedBy(owner: CommitmentOwner, ref?: number): readonly number[];
}

/** Write side — only settler-tasks' JobService holds it (claimed once). */
export interface UnitCommitmentWriter {
    set(unitId: number, commitment: UnitCommitment): void;
    /** Remove the unit's commitment. Throws if it has none. */
    clear(unitId: number): void;
}

const NO_UNITS: readonly number[] = [];

export class UnitCommitments implements UnitCommitmentQuery {
    private readonly byUnit = new Map<number, UnitCommitment>();
    private readonly byOwner = new Map<CommitmentOwner, Set<number>>();
    private writerClaimed = false;

    /** @param legacyReservations TRANSITIONAL: OR-ed into isReserved / isIdle until Cleanup. */
    constructor(private readonly legacyReservations: UnitReservationRegistry) {}

    get(unitId: number): UnitCommitment | undefined {
        return this.byUnit.get(unitId);
    }

    isIdle(unitId: number): boolean {
        return !this.byUnit.has(unitId) && !this.legacyReservations.isReserved(unitId);
    }

    isReserved(unitId: number): boolean {
        const commitment = this.byUnit.get(unitId);
        return (commitment !== undefined && commitment.reserved) || this.legacyReservations.isReserved(unitId);
    }

    unitsOwnedBy(owner: CommitmentOwner, ref?: number): readonly number[] {
        const units = this.byOwner.get(owner);
        if (!units) {
            return NO_UNITS;
        }
        const ids = ref === undefined ? [...units] : [...units].filter(id => this.byUnit.get(id)!.ref === ref);
        return ids.sort((a, b) => a - b);
    }

    /**
     * Hand out the write side. Called once per game by settler-tasks (JobService); a second
     * claim means another feature tries to write commitments directly (Invariant 3).
     */
    claimWriter(): UnitCommitmentWriter {
        if (this.writerClaimed) {
            throw new Error(
                'UnitCommitments writer already claimed — only settler-tasks JobService writes commitments'
            );
        }
        this.writerClaimed = true;
        return {
            set: (unitId, commitment) => this.set(unitId, commitment),
            clear: unitId => this.clear(unitId),
        };
    }

    private set(unitId: number, commitment: UnitCommitment): void {
        const previous = this.byUnit.get(unitId);
        if (previous) {
            this.byOwner.get(previous.owner)!.delete(unitId);
        }
        this.byUnit.set(unitId, commitment);
        let owned = this.byOwner.get(commitment.owner);
        if (!owned) {
            owned = new Set();
            this.byOwner.set(commitment.owner, owned);
        }
        owned.add(unitId);
    }

    private clear(unitId: number): void {
        const commitment = this.byUnit.get(unitId);
        if (!commitment) {
            throw new Error(`UnitCommitments.clear: unit ${unitId} has no commitment`);
        }
        this.byUnit.delete(unitId);
        this.byOwner.get(commitment.owner)!.delete(unitId);
    }
}

/**
 * PreAssignmentQueue — stores queued transport assignments for busy carriers.
 *
 * When a carrier in PickedUp phase is closer (estimated) than the best idle carrier,
 * CarrierAssigner queues a follow-up assignment here. When the carrier finishes its
 * current delivery, LogisticsDispatcher flushes the queue and assigns the job immediately.
 *
 * Invariants:
 * - At most one queued assignment per carrier.
 * - Queued jobs have pending reservations in TransportJobStore (not in the active jobs map).
 * - When a queued assignment is cancelled, the pending reservation is removed.
 */

import type { TransportJobRecord } from './transport-job-record';
import type { TransportJobDeps } from './transport-job-service';
import { cancel as cancelJob } from './transport-job-service';
import type { ChoreoJobState } from '../../systems/choreo';
import { sortedEntries } from '@/utilities/collections';
import type { Tile } from '@/game/core/coordinates';

/** A queued assignment waiting for a busy carrier to finish its current job. */
export interface QueuedAssignment {
    /** The carrier that will execute this job when it finishes its current delivery. */
    carrierId: number;
    /** The transport job record (already activated — pending reservation in TransportJobStore). */
    record: TransportJobRecord;
    /** The choreo job state to assign when the carrier becomes available. */
    job: ChoreoJobState;
    /** First movement target for assignJob. */
    moveTo: Tile;
}

/**
 * Manages queued transport assignments for busy carriers.
 *
 * Pure data structure — no event subscriptions. LogisticsDispatcher calls
 * cancel/flush from its own event handlers.
 */
export class PreAssignmentQueue {
    private readonly entries = new Map<number, QueuedAssignment>();
    private readonly deps: TransportJobDeps;

    constructor(deps: TransportJobDeps) {
        this.deps = deps;
    }

    /**
     * Queue an assignment for a carrier that's currently busy.
     * If the carrier already has a queued assignment, the old one is cancelled first.
     */
    queue(assignment: QueuedAssignment): void {
        const existing = this.entries.get(assignment.carrierId);
        if (existing) {
            this.cancelRecord(existing.record);
        }
        this.entries.set(assignment.carrierId, assignment);
    }

    /**
     * Flush the queued assignment for a carrier that just finished.
     * Returns the assignment to execute, or null if nothing queued.
     * Removes the entry from the queue (but NOT the pending reservation —
     * the caller promotes it via jobStore.promotePending).
     */
    flush(carrierId: number): QueuedAssignment | null {
        const assignment = this.entries.get(carrierId);
        if (!assignment) {
            return null;
        }
        this.entries.delete(carrierId);
        return assignment;
    }

    /**
     * Cancel the queued assignment for a carrier (carrier killed, current job cancelled).
     * Removes the pending reservation from TransportJobStore and emits cancellation event.
     * No-op if the carrier has no queued assignment.
     */
    cancel(carrierId: number): void {
        const assignment = this.entries.get(carrierId);
        if (!assignment) {
            return;
        }
        this.entries.delete(carrierId);
        this.cancelRecord(assignment.record);
    }

    /**
     * Cancel all queued assignments referencing a building (as source or dest).
     * Used when a building is destroyed.
     */
    cancelForBuilding(buildingId: number): void {
        for (const [carrierId, assignment] of sortedEntries(this.entries)) {
            if (assignment.record.sourceBuilding === buildingId || assignment.record.destBuilding === buildingId) {
                this.entries.delete(carrierId);
                this.cancelRecord(assignment.record);
            }
        }
    }

    /** Check if a carrier has a queued assignment. */
    has(carrierId: number): boolean {
        return this.entries.has(carrierId);
    }

    /** Number of queued assignments. For diagnostics. */
    get size(): number {
        return this.entries.size;
    }

    /** Remove pending reservation from the store and emit cancellation event. */
    private cancelRecord(record: TransportJobRecord): void {
        this.deps.jobStore.removePending(record.id);
        cancelJob(record, 'cancelled', this.deps);
    }
}

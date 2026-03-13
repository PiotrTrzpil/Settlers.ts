/**
 * TransportJobStore — single source of truth for all active transport jobs.
 *
 * Wraps PersistentIndexedMap<TransportJobRecord> with derived query methods that replace
 * InventoryReservationManager, InFlightTracker, and RequestManager status tracking.
 *
 * All reservation and in-flight queries are derived from job records — no separate
 * data structures. The job's existence at a given phase IS the reservation/in-flight state.
 *
 * Pending reservations: When a busy carrier is pre-assigned a follow-up job, the record
 * is stored in `pendingReservations` (not in `jobs`) to avoid overwriting the carrier's
 * active job. Pending reservations are counted in supply calculations so material isn't
 * double-allocated. When the carrier finishes its current delivery, the pending record
 * is promoted to the active `jobs` map via `promotePending()`.
 */

import { PersistentIndexedMap, PersistentValue } from '../../persistence/persistent-store';
import type { Index } from '@/game/utils/indexed-map';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import type { EMaterialType } from '../../economy/material-type';

/**
 * Single source of truth for all active transport jobs.
 *
 * Indexes:
 * - byBuilding: building ID → carrier IDs (both source and dest)
 * - byPhase: transport phase → carrier IDs
 * - byDemand: demandId → carrier ID (1:1)
 */
export class TransportJobStore {
    /** Primary store: carrierId → TransportJobRecord */
    readonly jobs: PersistentIndexedMap<TransportJobRecord>;

    /** Index: building ID → carrier IDs (both source and dest). */
    readonly byBuilding: Index<number, number>;

    /** Index: transport phase → carrier IDs. */
    readonly byPhase: Index<TransportPhase, number>;

    /** Index: demandId → carrier ID (1:1, for demand consumption tracking). */
    readonly byDemand: Index<number, number>;

    /** Persisted next job ID counter. */
    readonly nextJobIdStore: PersistentValue<number>;

    /**
     * Pending reservations for busy carriers that have been pre-assigned a follow-up job.
     * Keyed by jobId. Counted in supply queries but NOT in the primary `jobs` map
     * (which is keyed by carrierId and would overwrite the carrier's active job).
     */
    private readonly pendingReservations = new Map<number, TransportJobRecord>();

    /** Module-level next job ID — synced with persistence. */
    private nextJobId = 1;

    constructor() {
        this.jobs = new PersistentIndexedMap<TransportJobRecord>('transportJobs');

        // Multi-value index: a job appears under both its source and dest building
        this.byBuilding = this.jobs.addIndex((_carrierId, job) => [job.sourceBuilding, job.destBuilding]);

        // Phase index: partition jobs by transport phase
        this.byPhase = this.jobs.addIndex((_carrierId, job) => job.phase);

        // Demand index: 1:1 mapping for O(1) "is this demand already assigned?" checks
        this.byDemand = this.jobs.addIndex((_carrierId, job) => job.demandId);

        this.nextJobIdStore = new PersistentValue<number>('transportNextJobId', 1, {
            serialize: () => this.nextJobId,
            deserialize: (raw: unknown) => {
                this.nextJobId = raw as number;
                return this.nextJobId;
            },
        });
    }

    /** Allocate the next job ID. */
    allocateJobId(): number {
        return this.nextJobId++;
    }

    /** Get the current next job ID (for testing). */
    getNextJobId(): number {
        return this.nextJobId;
    }

    /** Reset the job ID counter (for testing). */
    resetJobIds(): void {
        this.nextJobId = 1;
    }

    // ── Pending reservations (pre-assigned follow-up jobs for busy carriers) ──

    /**
     * Add a pending reservation for a pre-assigned job.
     * The record is NOT added to the primary `jobs` map — it lives here until
     * the carrier finishes its current delivery and `promotePending()` is called.
     */
    addPendingReservation(record: TransportJobRecord): void {
        this.pendingReservations.set(record.id, record);
    }

    /**
     * Promote a pending reservation to the active `jobs` map.
     * Called when the carrier finishes its current delivery.
     * @returns The promoted record, or null if not found.
     */
    promotePending(jobId: number): TransportJobRecord | null {
        const record = this.pendingReservations.get(jobId);
        if (!record) {
            return null;
        }
        this.pendingReservations.delete(jobId);
        this.jobs.set(record.carrierId, record);
        return record;
    }

    /**
     * Remove and return a pending reservation (for cancellation).
     * Does NOT modify the primary `jobs` map.
     */
    removePending(jobId: number): TransportJobRecord | null {
        const record = this.pendingReservations.get(jobId);
        if (!record) {
            return null;
        }
        this.pendingReservations.delete(jobId);
        return record;
    }

    /** Check if a job ID is a pending reservation. */
    hasPending(jobId: number): boolean {
        return this.pendingReservations.has(jobId);
    }

    // ── Derived queries (replace InventoryReservationManager) ──

    /**
     * Total amount reserved at a source building for a material (phase=Reserved).
     * Includes both active jobs and pending reservations.
     * O(jobs-per-building), typically 1-5.
     */
    getReservedAmount(sourceBuilding: number, material: EMaterialType): number {
        let total = 0;
        // Active jobs
        for (const carrierId of this.byBuilding.get(sourceBuilding)) {
            const job = this.jobs.get(carrierId)!;
            if (
                job.sourceBuilding === sourceBuilding &&
                job.material === material &&
                job.phase === TransportPhase.Reserved
            ) {
                total += job.amount;
            }
        }
        // Pending reservations (pre-assigned follow-up jobs)
        for (const record of this.pendingReservations.values()) {
            if (
                record.sourceBuilding === sourceBuilding &&
                record.material === material &&
                record.phase === TransportPhase.Reserved
            ) {
                total += record.amount;
            }
        }
        return total;
    }

    /**
     * Unreserved supply = currentAmount - getReservedAmount().
     */
    getAvailableSupply(sourceBuilding: number, material: EMaterialType, currentAmount: number): number {
        return Math.max(0, currentAmount - this.getReservedAmount(sourceBuilding, material));
    }

    // ── Derived queries (replace InFlightTracker) ──

    /**
     * Total amount in flight toward a destination building for a material (phase=PickedUp).
     */
    getInFlightAmount(destBuilding: number, material: EMaterialType): number {
        let total = 0;
        for (const carrierId of this.byBuilding.get(destBuilding)) {
            const job = this.jobs.get(carrierId)!;
            if (
                job.destBuilding === destBuilding &&
                job.material === material &&
                job.phase === TransportPhase.PickedUp
            ) {
                total += job.amount;
            }
        }
        return total;
    }

    // ── Derived queries (replace RequestManager status tracking) ──

    /**
     * Count of active jobs targeting a building+material as destination.
     * Active = Reserved or PickedUp phase. Includes pending reservations.
     */
    getActiveJobCountForDest(destBuilding: number, material: EMaterialType): number {
        let count = 0;
        // Active jobs
        for (const carrierId of this.byBuilding.get(destBuilding)) {
            const job = this.jobs.get(carrierId)!;
            if (
                job.destBuilding === destBuilding &&
                job.material === material &&
                (job.phase === TransportPhase.Reserved || job.phase === TransportPhase.PickedUp)
            ) {
                count++;
            }
        }
        // Pending reservations
        for (const record of this.pendingReservations.values()) {
            if (
                record.destBuilding === destBuilding &&
                record.material === material &&
                (record.phase === TransportPhase.Reserved || record.phase === TransportPhase.PickedUp)
            ) {
                count++;
            }
        }
        return count;
    }

    /** Check if a demand ID already has a job (prevents double-assignment). */
    hasDemand(demandId: number): boolean {
        if (this.byDemand.get(demandId).size > 0) {
            return true;
        }
        // Also check pending reservations
        for (const record of this.pendingReservations.values()) {
            if (record.demandId === demandId) {
                return true;
            }
        }
        return false;
    }

    /** Get all jobs for a building (source or dest). */
    getJobsForBuilding(buildingId: number): TransportJobRecord[] {
        const result: TransportJobRecord[] = [];
        for (const carrierId of this.byBuilding.get(buildingId)) {
            result.push(this.jobs.get(carrierId)!);
        }
        return result;
    }
}

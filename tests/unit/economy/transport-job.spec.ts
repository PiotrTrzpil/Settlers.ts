// @vitest-environment jsdom
/**
 * Unit tests for TransportJobService — stateless lifecycle operations
 * for TransportJobRecord (supply accounting, queued activation, phase
 * transitions, terminal removal). Cancelling an active record stops the
 * carrier's Transport job through `jobs.cancel` (owner-initiated, no call-back);
 * the carrier's job lifecycle itself belongs to the job runtime.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as TransportJobService from '@/game/features/logistics/transport-job-service';
import type { TransportJobDeps } from '@/game/features/logistics/transport-job-service';
import { TransportPhase } from '@/game/features/logistics/transport-job-record';
import { DemandLedger } from '@/game/features/logistics/demand-ledger';
import { TransportJobStore } from '@/game/features/logistics/transport-job-store';
import { EMaterialType } from '@/game/economy';
import type { BuildingInventoryManager } from '@/game/features/inventory';
import { EventBus } from '@/game/event-bus';
import { JobKind } from '@/game/systems/choreo';

// ─── Minimal BuildingInventoryManager stub ──────────────────────────
// activate() only reads getOutputAmount(); everything else (withdrawal,
// deposit) is handled by the choreography, outside the service.

function createInventoryStub(outputAmount: number) {
    return {
        getOutputAmount(_buildingId: number, _material: EMaterialType): number {
            return outputAmount;
        },
    };
}

// ─── Minimal job-runtime stub: records `jobs.cancel` calls ──────────

function createJobsStub() {
    const cancelled: { unitId: number; owner: string }[] = [];
    return {
        cancelled,
        cancel: (unitId: number, owner: string) => {
            cancelled.push({ unitId, owner });
        },
    };
}

// ─── Test setup (module scope — the top-level beforeEach applies to all
// describes in this file, keeping each describe under the function-size cap) ──

let demandLedger: DemandLedger;
let jobStore: TransportJobStore;
let eventBus: EventBus;
let jobs: ReturnType<typeof createJobsStub>;
let deps: TransportJobDeps;

const SOURCE = 100;
const DEST = 200;
const CARRIER = 1;
const MATERIAL = EMaterialType.LOG;

function makeDeps(outputAmount: number): TransportJobDeps {
    return {
        jobStore,
        demandLedger,
        eventBus,
        inventoryManager: createInventoryStub(outputAmount) as unknown as BuildingInventoryManager,
        jobs,
    };
}

beforeEach(() => {
    jobStore = new TransportJobStore();
    eventBus = new EventBus();
    demandLedger = new DemandLedger();
    jobs = createJobsStub();
    deps = makeDeps(5);
});

function activate(amount = 1, carrierId = CARRIER, options?: { queued?: boolean }) {
    return TransportJobService.activate(SOURCE, DEST, MATERIAL, amount, carrierId, deps, options);
}

// ─── activate ───────────────────────────────────────────────────────

describe('TransportJobService.activate', () => {
    it('creates a Reserved record in the store that claims source stock', () => {
        const record = activate();

        expect(record).not.toBeNull();
        expect(record!.phase).toBe(TransportPhase.Reserved);
        expect(record!.sourceBuilding).toBe(SOURCE);
        expect(record!.destBuilding).toBe(DEST);
        expect(record!.material).toBe(MATERIAL);
        expect(record!.amount).toBe(1);
        expect(record!.carrierId).toBe(CARRIER);

        expect(jobStore.get(record!.id)).toBe(record);
        expect(jobStore.getActiveJobForCarrier(CARRIER)).toBe(record);
        expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(1);
    });

    it('returns null if inventory supply is insufficient', () => {
        deps = makeDeps(0);

        expect(activate()).toBeNull();
        expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(0);
    });

    it('returns null if all supply is already reserved by another job', () => {
        const first = activate(5, 99);
        expect(first).not.toBeNull();

        expect(activate(1)).toBeNull();
    });

    it('counts both Queued and Reserved jobs against available supply', () => {
        // Supply is 5: a Reserved 3 + a Queued 2 consume all of it.
        expect(activate(3, 90)).not.toBeNull();
        expect(activate(2, 91, { queued: true })).not.toBeNull();

        expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(5);
        expect(jobStore.getAvailableSupply(SOURCE, MATERIAL, 5)).toBe(0);
        expect(activate(1)).toBeNull();
    });

    it('creates a Queued follow-up record when options.queued is set', () => {
        const active = activate(1)!;
        const queued = activate(1, CARRIER, { queued: true });

        expect(queued).not.toBeNull();
        expect(queued!.phase).toBe(TransportPhase.Queued);
        expect(jobStore.getQueuedJobForCarrier(CARRIER)).toBe(queued);
        expect(jobStore.getActiveJobForCarrier(CARRIER)).toBe(active);
    });
});

// ─── promoteQueued ──────────────────────────────────────────────────

describe('TransportJobService.promoteQueued', () => {
    it('promotes a Queued record to Reserved and reindexes it', () => {
        const record = activate(1, CARRIER, { queued: true })!;

        TransportJobService.promoteQueued(record, deps);

        expect(record.phase).toBe(TransportPhase.Reserved);
        expect(jobStore.getActiveJobForCarrier(CARRIER)).toBe(record);
        expect(jobStore.getQueuedJobForCarrier(CARRIER)).toBeUndefined();
        expect([...jobStore.byPhase.get(TransportPhase.Queued)]).toHaveLength(0);
        expect([...jobStore.byPhase.get(TransportPhase.Reserved)]).toEqual([record.id]);
    });

    it('throws if the record is not Queued', () => {
        const record = activate()!;

        expect(() => TransportJobService.promoteQueued(record, deps)).toThrow(/reserved/);
    });
});

// ─── pickUp ─────────────────────────────────────────────────────────

describe('TransportJobService.pickUp', () => {
    it('moves Reserved → PickedUp: stock claim released, amount now in flight', () => {
        const record = activate()!;

        TransportJobService.pickUp(record, deps);

        expect(record.phase).toBe(TransportPhase.PickedUp);
        expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(0);
        expect(jobStore.getInFlightAmount(DEST, MATERIAL)).toBe(1);
    });

    it('throws if called when already PickedUp', () => {
        const record = activate()!;
        TransportJobService.pickUp(record, deps);

        expect(() => TransportJobService.pickUp(record, deps)).toThrow(/picked-up/);
    });

    it('throws if called on a Queued record', () => {
        const record = activate(1, CARRIER, { queued: true })!;

        expect(() => TransportJobService.pickUp(record, deps)).toThrow(/queued/);
    });

    it('throws if called when cancelled', () => {
        const record = activate()!;
        TransportJobService.cancel(record, 'test', deps);

        expect(() => TransportJobService.pickUp(record, deps)).toThrow(/cancelled/);
    });
});

// ─── deliver ────────────────────────────────────────────────────────

describe('TransportJobService.deliver', () => {
    it('removes the record from the store and emits logistics:demandFulfilled', () => {
        const fulfilled: { buildingId: number; materialType: EMaterialType }[] = [];
        eventBus.on('logistics:demandFulfilled', payload => fulfilled.push(payload));

        const record = activate()!;
        TransportJobService.pickUp(record, deps);
        TransportJobService.deliver(record, deps);

        expect(record.phase).toBe(TransportPhase.Delivered);
        expect(jobStore.get(record.id)).toBeUndefined();
        expect(jobStore.getIncomingAmount(DEST, MATERIAL)).toBe(0);
        expect(fulfilled).toEqual([{ buildingId: DEST, materialType: MATERIAL }]);
    });

    it("does not stop the carrier's job (its completion after the stand-up frees the carrier)", () => {
        const record = activate()!;

        TransportJobService.pickUp(record, deps);
        TransportJobService.deliver(record, deps);

        expect(jobs.cancelled).toEqual([]);
    });

    it('throws if called when still Reserved (not picked up)', () => {
        const record = activate()!;

        expect(() => TransportJobService.deliver(record, deps)).toThrow(/reserved/);
    });

    it('throws if called when cancelled', () => {
        const record = activate()!;
        TransportJobService.cancel(record, 'test', deps);

        expect(() => TransportJobService.deliver(record, deps)).toThrow(/cancelled/);
    });
});

// ─── cancel ─────────────────────────────────────────────────────────

describe('TransportJobService.cancel', () => {
    it("removes the record, stops the carrier's Transport job and notifies", () => {
        const events: { unitId: number; jobId: number; reason: string }[] = [];
        eventBus.on('carrier:transportCancelled', ({ unitId, jobId, reason }) =>
            events.push({ unitId, jobId, reason })
        );

        const record = activate()!;

        TransportJobService.cancel(record, 'building destroyed', deps);

        expect(record.phase).toBe(TransportPhase.Cancelled);
        expect(jobStore.get(record.id)).toBeUndefined();
        expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(0);
        expect(jobs.cancelled).toEqual([{ unitId: CARRIER, owner: JobKind.Transport }]);
        expect(events).toEqual([{ unitId: CARRIER, jobId: record.id, reason: 'building destroyed' }]);
    });

    it("does NOT notify or touch the carrier's job when cancelling a Queued record", () => {
        const events: unknown[] = [];
        eventBus.on('carrier:transportCancelled', payload => events.push(payload));

        const active = activate()!;
        const queued = activate(1, CARRIER, { queued: true })!;

        TransportJobService.cancel(queued, 'rerouted', deps);

        expect(queued.phase).toBe(TransportPhase.Cancelled);
        expect(jobStore.get(queued.id)).toBeUndefined();
        // The active job stays intact; the carrier's running job is not stopped.
        expect(jobStore.getActiveJobForCarrier(CARRIER)).toBe(active);
        expect(jobs.cancelled).toEqual([]);
        expect(events).toHaveLength(0);
    });

    it('allocates record ids from the store counter', () => {
        const first = activate()!;
        const second = activate(1, 2)!;
        expect(second.id).toBe(first.id + 1);
        expect(jobStore.nextIdStore.get()).toBe(second.id + 1);
    });

    it("discard removes the record without stopping the carrier's job (it already ended)", () => {
        const record = activate()!;

        TransportJobService.discard(record, 'carrier died', deps);

        expect(jobStore.get(record.id)).toBeUndefined();
        expect(jobs.cancelled).toEqual([]);
    });

    it('cancels a PickedUp record (no stock claim to release)', () => {
        const record = activate()!;
        TransportJobService.pickUp(record, deps);

        TransportJobService.cancel(record, 'test', deps);

        expect(record.phase).toBe(TransportPhase.Cancelled);
        expect(jobStore.getInFlightAmount(DEST, MATERIAL)).toBe(0);
    });

    it('is a no-op if already cancelled (emits only once)', () => {
        let eventCount = 0;
        eventBus.on('carrier:transportCancelled', () => eventCount++);

        const record = activate()!;
        TransportJobService.cancel(record, 'test', deps);
        TransportJobService.cancel(record, 'test', deps);

        expect(record.phase).toBe(TransportPhase.Cancelled);
        expect(eventCount).toBe(1);
    });

    it('is a no-op if already delivered', () => {
        const record = activate()!;
        TransportJobService.pickUp(record, deps);
        TransportJobService.deliver(record, deps);

        TransportJobService.cancel(record, 'test', deps);

        expect(record.phase).toBe(TransportPhase.Delivered);
    });
});

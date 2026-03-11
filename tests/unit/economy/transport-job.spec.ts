// @vitest-environment jsdom
/**
 * Unit tests for TransportJobService — stateless lifecycle operations
 * for TransportJobRecord (job store queries, demand consumption, and inventory operations).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as TransportJobService from '@/game/features/logistics/transport-job-service';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import { DemandQueue, DemandPriority } from '@/game/features/logistics/demand-queue';
import { TransportJobStore } from '@/game/features/logistics/transport-job-store';
import { EMaterialType } from '@/game/economy';
import type { BuildingInventoryManager } from '@/game/features/inventory';
import { EventBus } from '@/game/event-bus';
import type { TransportJobDeps } from '@/game/features/logistics/transport-job-service';

// ─── Minimal BuildingInventoryManager stub ──────────────────────────

function createInventoryStub(outputAmount = 5) {
    const slots = new Map<string, { current: number }>();

    function key(buildingId: number, material: EMaterialType) {
        return `${buildingId}:${material}`;
    }

    function getOrCreate(buildingId: number, material: EMaterialType) {
        const k = key(buildingId, material);
        if (!slots.has(k)) {
            slots.set(k, { current: outputAmount });
        }
        return slots.get(k)!;
    }

    return {
        getOutputAmount(buildingId: number, material: EMaterialType): number {
            return getOrCreate(buildingId, material).current;
        },
        withdrawOutput(buildingId: number, material: EMaterialType, amount: number): void {
            const slot = getOrCreate(buildingId, material);
            slot.current -= amount;
        },
        getBuildingsWithOutput: () => [],
        getInventory: () => undefined,
        _slots: slots,
    };
}

// ─── Test setup ─────────────────────────────────────────────────────

describe('TransportJobService', () => {
    let demandQueue: DemandQueue;
    let jobStore: TransportJobStore;
    let inventoryManager: ReturnType<typeof createInventoryStub>;
    let eventBus: EventBus;
    let deps: TransportJobDeps;

    const SOURCE = 100;
    const DEST = 200;
    const CARRIER = 1;
    const MATERIAL = EMaterialType.LOG;

    beforeEach(() => {
        jobStore = new TransportJobStore();
        jobStore.resetJobIds();
        eventBus = new EventBus();
        demandQueue = new DemandQueue(eventBus);
        inventoryManager = createInventoryStub(5);
        deps = {
            jobStore,
            demandQueue,
            eventBus,
            inventoryManager: inventoryManager as unknown as BuildingInventoryManager,
        };
    });

    function addDemand() {
        return demandQueue.addDemand(DEST, MATERIAL, 1, DemandPriority.Normal);
    }

    function createRecord(demand = addDemand()): TransportJobRecord | null {
        return TransportJobService.activate(demand.id, SOURCE, DEST, MATERIAL, 1, CARRIER, deps);
    }

    // ─── activate ───────────────────────────────────────────────────

    describe('activate', () => {
        it('creates job record at Reserved phase and consumes demand', () => {
            const demand = addDemand();
            const record = createRecord(demand);

            expect(record).not.toBeNull();
            expect(record!.phase).toBe(TransportPhase.Reserved);
            expect(record!.sourceBuilding).toBe(SOURCE);
            expect(record!.destBuilding).toBe(DEST);
            expect(record!.material).toBe(MATERIAL);
            expect(record!.amount).toBe(1);
            expect(record!.demandId).toBe(demand.id);

            // Demand should be consumed
            expect(demandQueue.getDemand(demand.id)).toBeUndefined();

            // Job should be in the store
            expect(jobStore.jobs.get(CARRIER)).toBe(record);
            expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(1);
        });

        it('returns null if inventory supply is insufficient', () => {
            inventoryManager = createInventoryStub(0);
            deps = {
                jobStore,
                demandQueue,
                eventBus,
                inventoryManager: inventoryManager as unknown as BuildingInventoryManager,
            };

            const demand = addDemand();
            const record = TransportJobService.activate(demand.id, SOURCE, DEST, MATERIAL, 1, CARRIER, deps);

            expect(record).toBeNull();
            // Demand should still be in the queue (not consumed)
            expect(demandQueue.getDemand(demand.id)).toBeDefined();
        });

        it('returns null if all inventory is already reserved by another job', () => {
            // Pre-fill with a reservation for the full amount
            const existingRecord: TransportJobRecord = {
                id: 999,
                demandId: 999,
                sourceBuilding: SOURCE,
                destBuilding: 201,
                material: MATERIAL,
                amount: 5,
                carrierId: 99,
                phase: TransportPhase.Reserved,
                createdAt: 0,
            };
            jobStore.jobs.set(99, existingRecord);

            const demand = addDemand();
            const record = TransportJobService.activate(demand.id, SOURCE, DEST, MATERIAL, 1, CARRIER, deps);

            expect(record).toBeNull();
        });
    });

    // ─── pickUp ─────────────────────────────────────────────────────

    describe('pickUp', () => {
        it('transitions to picked-up phase (withdrawal handled by choreography)', () => {
            const record = createRecord()!;

            TransportJobService.pickUp(record, deps);

            expect(record.phase).toBe(TransportPhase.PickedUp);
            // Reservation is gone (phase changed from Reserved)
            expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(0);
            // Inventory is NOT reduced here — the choreography handles withdrawal via MaterialTransfer.pickUp()
            expect(inventoryManager.getOutputAmount(SOURCE, MATERIAL)).toBe(5);
        });

        it('throws if called when not Reserved', () => {
            const record = createRecord()!;
            TransportJobService.pickUp(record, deps);

            expect(() => TransportJobService.pickUp(record, deps)).toThrow(/picked-up/);
        });

        it('throws if called when cancelled', () => {
            const record = createRecord()!;
            TransportJobService.cancel(record, 'cancelled', deps);

            expect(() => TransportJobService.pickUp(record, deps)).toThrow(/cancelled/);
        });
    });

    // ─── deliver ────────────────────────────────────────────────────

    describe('deliver', () => {
        it('transitions to Delivered phase after pickup', () => {
            const demand = addDemand();
            const record = createRecord(demand)!;
            TransportJobService.pickUp(record, deps);

            TransportJobService.deliver(record, deps);

            expect(record.phase).toBe(TransportPhase.Delivered);
        });

        it('throws if called when still Reserved (not picked up)', () => {
            const record = createRecord()!;

            expect(() => TransportJobService.deliver(record, deps)).toThrow(/reserved/);
        });

        it('throws if called when cancelled', () => {
            const record = createRecord()!;
            TransportJobService.cancel(record, 'cancelled', deps);

            expect(() => TransportJobService.deliver(record, deps)).toThrow(/cancelled/);
        });
    });

    // ─── cancel ─────────────────────────────────────────────────────

    describe('cancel', () => {
        it('transitions to Cancelled phase and releases reservation when Reserved', () => {
            const record = createRecord()!;

            TransportJobService.cancel(record, 'cancelled', deps);

            expect(record.phase).toBe(TransportPhase.Cancelled);
            // Reservation is released (no Reserved jobs in store)
            expect(jobStore.getReservedAmount(SOURCE, MATERIAL)).toBe(0);
        });

        it('transitions to Cancelled phase when PickedUp (no reservation to release)', () => {
            const record = createRecord()!;
            TransportJobService.pickUp(record, deps);

            TransportJobService.cancel(record, 'cancelled', deps);

            expect(record.phase).toBe(TransportPhase.Cancelled);
        });

        it('is a no-op if already cancelled', () => {
            const record = createRecord()!;
            TransportJobService.cancel(record, 'cancelled', deps);
            TransportJobService.cancel(record, 'cancelled', deps); // second call should be fine

            expect(record.phase).toBe(TransportPhase.Cancelled);
        });

        it('is a no-op if already delivered', () => {
            const record = createRecord()!;
            TransportJobService.pickUp(record, deps);
            TransportJobService.deliver(record, deps);
            TransportJobService.cancel(record, 'cancelled', deps); // should be fine

            expect(record.phase).toBe(TransportPhase.Delivered);
        });
    });
});

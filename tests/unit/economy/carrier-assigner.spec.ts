/**
 * CarrierAssigner ranking must apply the carrier filter to busy follow-up
 * candidates, not only idle carriers. Otherwise a carrier in a disconnected
 * territory pocket is queued for a job it cannot walk to.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '@/game/event-bus';
import { EMaterialType } from '@/game/economy';
import { CarrierAssigner } from '@/game/features/logistics/carrier-assigner';
import { DemandLedger } from '@/game/features/logistics/demand-ledger';
import { TransportJobStore } from '@/game/features/logistics/transport-job-store';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import type { IdleCarrierPool } from '@/game/features/carriers';
import type { TransportJobAssigner } from '@/game/features/logistics/transport-job-kind';
import type { BuildingInventoryManager } from '@/game/features/inventory';
import type { GameState } from '@/game/game-state';
import type { Entity } from '@/game/entity';

const SOURCE = 10;
const DEST = 20;
const BUSY_DEST = 30;
const BUSY_CARRIER = 1;
const PLAYER = 0;

function entity(id: number, x: number, y: number, player = PLAYER): Entity {
    return { id, x, y, player } as Entity;
}

describe('CarrierAssigner busy-carrier filter', () => {
    let jobStore: TransportJobStore;
    let eventBus: EventBus;
    let demandLedger: DemandLedger;
    const entities = new Map<number, Entity>();

    beforeEach(() => {
        jobStore = new TransportJobStore();
        eventBus = new EventBus();
        demandLedger = new DemandLedger();
        entities.clear();
        entities.set(SOURCE, entity(SOURCE, 50, 50));
        entities.set(DEST, entity(DEST, 55, 50));
        entities.set(BUSY_DEST, entity(BUSY_DEST, 5, 5));
        entities.set(BUSY_CARRIER, entity(BUSY_CARRIER, 6, 5));
    });

    function makeAssigner(filter: (carrierId: number) => boolean): CarrierAssigner {
        const record: TransportJobRecord = {
            id: 1,
            sourceBuilding: DEST,
            destBuilding: BUSY_DEST,
            material: EMaterialType.BOARD,
            amount: 1,
            carrierId: BUSY_CARRIER,
            phase: TransportPhase.PickedUp,
            createdAt: 0,
        };
        jobStore.add(record);

        const gameState = {
            getEntityOrThrow: (id: number, ctx: string) => {
                const e = entities.get(id);
                if (!e) {
                    throw new Error(`missing entity ${id} (${ctx})`);
                }
                return e;
            },
        } as unknown as GameState;

        return new CarrierAssigner({
            gameState,
            eventBus,
            idleCarrierPool: {
                findNearestWithCost: () => null,
            } as unknown as IdleCarrierPool,
            transportJobs: { assign: () => true } satisfies TransportJobAssigner,
            transportJobDeps: {
                jobStore,
                demandLedger,
                eventBus,
                inventoryManager: {
                    getOutputAmount: () => 8,
                } as unknown as BuildingInventoryManager,
                jobs: { cancel: () => {} },
            },
            carrierFilter: (carrier, _player, _nearX, _nearY) => filter(carrier.id),
        });
    }

    it('does not queue a busy carrier rejected by the eligibility filter', () => {
        const assigner = makeAssigner(id => id !== BUSY_CARRIER);

        const result = assigner.tryAssignBest({ buildingId: DEST, materialType: EMaterialType.LOG, amount: 1 }, [
            { sourceBuilding: SOURCE, amount: 1, distance: 5, playerId: PLAYER },
        ]);

        expect(result.status).toBe('no_carrier');
        expect(jobStore.getQueuedJobForCarrier(BUSY_CARRIER)).toBeUndefined();
    });

    it('queues a busy carrier that passes the eligibility filter', () => {
        const assigner = makeAssigner(() => true);

        const result = assigner.tryAssignBest({ buildingId: DEST, materialType: EMaterialType.LOG, amount: 1 }, [
            { sourceBuilding: SOURCE, amount: 1, distance: 5, playerId: PLAYER },
        ]);

        expect(result.status).toBe('assigned');
        if (result.status === 'assigned') {
            expect(result.queued).toBe(true);
            expect(result.carrierId).toBe(BUSY_CARRIER);
        }
        expect(jobStore.getQueuedJobForCarrier(BUSY_CARRIER)).toBeDefined();
    });
});

describe('CarrierAssigner reservation on assign failure', () => {
    it('releases the source reservation if the job assignment throws', () => {
        const jobStore = new TransportJobStore();
        const eventBus = new EventBus();
        const demandLedger = new DemandLedger();
        const idleCarrierId = 7;
        const entities = new Map<number, Entity>([
            [SOURCE, entity(SOURCE, 50, 50)],
            [DEST, entity(DEST, 55, 50)],
            [idleCarrierId, entity(idleCarrierId, 51, 50)],
        ]);

        const gameState = {
            getEntityOrThrow: (id: number, ctx: string) => {
                const e = entities.get(id);
                if (!e) {
                    throw new Error(`missing entity ${id} (${ctx})`);
                }
                return e;
            },
        } as unknown as GameState;

        const assigner = new CarrierAssigner({
            gameState,
            eventBus,
            idleCarrierPool: {
                findNearestWithCost: () => ({ carrierId: idleCarrierId, distSq: 1 }),
            } as unknown as IdleCarrierPool,
            transportJobs: {
                assign: () => {
                    throw new Error('pathfinding exploded');
                },
            } satisfies TransportJobAssigner,
            transportJobDeps: {
                jobStore,
                demandLedger,
                eventBus,
                inventoryManager: {
                    getOutputAmount: () => 8,
                } as unknown as BuildingInventoryManager,
                jobs: { cancel: () => {} },
            },
        });

        expect(() =>
            assigner.tryAssignBest({ buildingId: DEST, materialType: EMaterialType.LOG, amount: 1 }, [
                { sourceBuilding: SOURCE, amount: 1, distance: 5, playerId: PLAYER },
            ])
        ).toThrow('pathfinding exploded');

        expect(jobStore.getActiveJobForCarrier(idleCarrierId)).toBeUndefined();
        expect(jobStore.getReservedAmount(SOURCE, EMaterialType.LOG)).toBe(0);
    });
});

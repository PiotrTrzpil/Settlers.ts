/**
 * Integration tests for specialist recruitment and dismissal.
 *
 * All creation and dismissal is driven via the `recruit_specialist` command,
 * same as the UI. Tests cover:
 *   - Carrier transforms to specialist via queue drain (tool-based, e.g. Geologist)
 *   - Carrier transforms to specialist with no tool (Thief, direct in-place)
 *   - Decrementing queue before drain cancels the request
 *   - Decrement drains queue first, then dismisses live specialists
 *   - Dismissed specialist drops tool on ground and returns to carrier pool
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function recruitSpecialist(sim: Simulation, unitType: UnitType, count: number, player = 0) {
    return sim.execute({ type: 'recruit_specialist', unitType, count, player, race: Race.Roman });
}

function countPilesOf(sim: Simulation, material: EMaterialType): number {
    return sim.state.entities.filter(e => e.type === EntityType.StackedPile && e.subType === material).length;
}

// ─── Thief & Geologist recruitment ────────────────────────────────────────

describe('Specialist recruitment – basic transforms', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('Thief: carrier transforms in place without a tool pile', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);

        const result = recruitSpecialist(sim, UnitType.Thief, 1);
        expect(result.success).toBe(true);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'Thief appears',
            diagnose: () =>
                `queued=${sim.services.recruitSystem.getQueuedCount(UnitType.Thief)} ` +
                `pending=${sim.services.unitTransformer.getPendingCountByType(UnitType.Thief)} ` +
                `thieves=${sim.countEntities(EntityType.Unit, UnitType.Thief)} ` +
                `carriers=${sim.countEntities(EntityType.Unit, UnitType.Carrier)}`,
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('Geologist: carrier walks to pickaxe pile and transforms', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.placeGoods(EMaterialType.PICKAXE, 1);

        const result = recruitSpecialist(sim, UnitType.Geologist, 1);
        expect(result.success).toBe(true);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Geologist)).toBe(1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
            maxTicks: 30_000,
            label: 'Geologist appears',
            diagnose: () =>
                `queued=${sim.services.recruitSystem.getQueuedCount(UnitType.Geologist)} ` +
                `pending=${sim.services.unitTransformer.getPendingCountByType(UnitType.Geologist)} ` +
                `geologists=${sim.countEntities(EntityType.Unit, UnitType.Geologist)} ` +
                `carriers=${sim.countEntities(EntityType.Unit, UnitType.Carrier)}`,
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Geologist)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Queue decrement & dismissal ──────────────────────────────────────────

describe('Specialist recruitment – queue decrement & dismissal', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('decrement before drain cancels queued request — no specialist created', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);

        recruitSpecialist(sim, UnitType.Thief, 2);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(2);

        recruitSpecialist(sim, UnitType.Thief, -1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'one Thief appears',
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('decrement to zero clears queue entirely — no specialist created', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.placeGoods(EMaterialType.PICKAXE, 1);

        recruitSpecialist(sim, UnitType.Geologist, 3);
        recruitSpecialist(sim, UnitType.Geologist, -3);

        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Geologist)).toBe(0);

        sim.runTicks(200);

        expect(sim.countEntities(EntityType.Unit, UnitType.Geologist)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('decrement drains queue before dismissing live specialist', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.spawnUnit({ x: 65, y: 64 }, UnitType.Carrier);

        recruitSpecialist(sim, UnitType.Thief, 2);
        recruitSpecialist(sim, UnitType.Thief, -1);

        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'one Thief appears',
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('dismiss live specialist returns them to carrier pool', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        recruitSpecialist(sim, UnitType.Thief, 1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'Thief appears',
        });
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);

        const dismissResult = recruitSpecialist(sim, UnitType.Thief, -1);
        expect(dismissResult.success).toBe(true);

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('dismiss live Geologist drops pickaxe on the ground', () => {
        sim = createSimulation();

        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.placeGoods(EMaterialType.PICKAXE, 1);

        recruitSpecialist(sim, UnitType.Geologist, 1);
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
            maxTicks: 30_000,
            label: 'Geologist appears',
        });

        expect(countPilesOf(sim, EMaterialType.PICKAXE)).toBe(0);

        recruitSpecialist(sim, UnitType.Geologist, -1);

        expect(sim.countEntities(EntityType.Unit, UnitType.Geologist)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(countPilesOf(sim, EMaterialType.PICKAXE)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Partial recruitment (busy / reserved carriers) ──────────────────────

describe('Specialist recruitment – reserved carriers & batch', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('reserved carrier is skipped — queue stays full until carrier is free', () => {
        sim = createSimulation();

        const carrierId = sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.services.unitReservation.reserve(carrierId, { purpose: 'test' });

        recruitSpecialist(sim, UnitType.Thief, 1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        sim.runTicks(200);

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        sim.services.unitReservation.release(carrierId);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'Thief appears after release',
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('queue partially drains when only some carriers are idle', () => {
        sim = createSimulation();

        const reservedId = sim.spawnUnit({ x: 62, y: 64 }, UnitType.Carrier);
        sim.spawnUnit({ x: 63, y: 64 }, UnitType.Carrier);
        sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.services.unitReservation.reserve(reservedId, { purpose: 'test' });

        recruitSpecialist(sim, UnitType.Thief, 3);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 2, {
            maxTicks: 6_000,
            label: '2 Thieves from idle carriers',
            diagnose: () =>
                `queued=${sim.services.recruitSystem.getQueuedCount(UnitType.Thief)} ` +
                `thieves=${sim.countEntities(EntityType.Unit, UnitType.Thief)}`,
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(2);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('queue stays full when all carriers are reserved', () => {
        sim = createSimulation();

        const id1 = sim.spawnUnit({ x: 63, y: 64 }, UnitType.Carrier);
        const id2 = sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
        sim.services.unitReservation.reserve(id1, { purpose: 'test' });
        sim.services.unitReservation.reserve(id2, { purpose: 'test' });

        recruitSpecialist(sim, UnitType.Thief, 2);

        sim.runTicks(400);

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(2);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });

    it('queuing 5 Thieves with 5 carriers produces 5 Thieves', () => {
        sim = createSimulation();

        for (let i = 0; i < 5; i++) {
            sim.spawnUnit({ x: 60 + i, y: 64 }, UnitType.Carrier);
        }
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(5);

        recruitSpecialist(sim, UnitType.Thief, 5);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 5, {
            maxTicks: 6_000,
            label: '5 Thieves appear',
            diagnose: () =>
                `queued=${sim.services.recruitSystem.getQueuedCount(UnitType.Thief)} ` +
                `thieves=${sim.countEntities(EntityType.Unit, UnitType.Thief)}`,
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(5);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });
});

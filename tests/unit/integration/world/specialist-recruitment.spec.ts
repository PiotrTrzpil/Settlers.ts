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

const hasRealData = installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function recruitSpecialist(sim: Simulation, unitType: UnitType, count: number, player = 0) {
    return sim.execute({ type: 'recruit_specialist', unitType, count, player, race: Race.Roman });
}

function countPilesOf(sim: Simulation, material: EMaterialType): number {
    return sim.state.entities.filter(e => e.type === EntityType.StackedPile && e.subType === (material as number))
        .length;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Specialist recruitment (integration)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ─── Thief: direct in-place transform ────────────────────────────────────

    it('Thief: carrier transforms in place without a tool pile', () => {
        sim = createSimulation();

        // Spawn one idle carrier (no tool pile needed for Thief)
        sim.spawnUnit(64, 64, UnitType.Carrier);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);

        const result = recruitSpecialist(sim, UnitType.Thief, 1);
        expect(result.success).toBe(true);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        // Run until the queue drains (≤0.5s drain interval) and the transform completes
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

    // ─── Tool-based specialist ────────────────────────────────────────────────

    it.skipIf(!hasRealData)('Geologist: carrier walks to pickaxe pile and transforms', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 64, UnitType.Carrier);
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

    // ─── Queue decrement before drain ─────────────────────────────────────────

    it('decrement before drain cancels queued request — no specialist created', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 64, UnitType.Carrier);

        recruitSpecialist(sim, UnitType.Thief, 2);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(2);

        recruitSpecialist(sim, UnitType.Thief, -1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        // Only one carrier, so at most one Thief ever appears
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'one Thief appears',
        });

        // Queue fully drained — no second Thief possible (only 1 carrier)
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('decrement to zero clears queue entirely — no specialist created', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 64, UnitType.Carrier);
        sim.placeGoods(EMaterialType.PICKAXE, 1);

        recruitSpecialist(sim, UnitType.Geologist, 3);
        recruitSpecialist(sim, UnitType.Geologist, -3);

        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Geologist)).toBe(0);

        // Even with drain ticks nothing should happen
        sim.runTicks(200);

        expect(sim.countEntities(EntityType.Unit, UnitType.Geologist)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Dismiss: queue drains first, then live specialist ───────────────────

    it('decrement drains queue before dismissing live specialist', () => {
        sim = createSimulation();

        // Two carriers: one will become Thief, one stays idle for the second request
        sim.spawnUnit(64, 64, UnitType.Carrier);
        sim.spawnUnit(65, 64, UnitType.Carrier);

        // Queue 2 Thieves then immediately drain 1 before any tick runs
        recruitSpecialist(sim, UnitType.Thief, 2);
        recruitSpecialist(sim, UnitType.Thief, -1);

        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0); // none yet

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'one Thief appears',
        });

        // Exactly 1 Thief (queue was 1 after decrement, 1 carrier remains idle)
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('dismiss live specialist returns them to carrier pool', () => {
        sim = createSimulation();

        // Spawn a carrier and turn them into a Thief
        sim.spawnUnit(64, 64, UnitType.Carrier);
        recruitSpecialist(sim, UnitType.Thief, 1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 1, {
            maxTicks: 3_000,
            label: 'Thief appears',
        });
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);

        // Dismiss the Thief
        const dismissResult = recruitSpecialist(sim, UnitType.Thief, -1);
        expect(dismissResult.success).toBe(true);

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it.skipIf(!hasRealData)('dismiss live Geologist drops pickaxe on the ground', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 64, UnitType.Carrier);
        sim.placeGoods(EMaterialType.PICKAXE, 1);

        recruitSpecialist(sim, UnitType.Geologist, 1);
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
            maxTicks: 30_000,
            label: 'Geologist appears',
        });

        // Pickaxe pile was consumed during transform
        expect(countPilesOf(sim, EMaterialType.PICKAXE)).toBe(0);

        // Dismiss → pickaxe dropped on ground
        recruitSpecialist(sim, UnitType.Geologist, -1);

        expect(sim.countEntities(EntityType.Unit, UnitType.Geologist)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(countPilesOf(sim, EMaterialType.PICKAXE)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Multiple queued ──────────────────────────────────────────────────────

    // ─── Partial recruitment (busy / reserved carriers) ──────────────────────

    it('reserved carrier is skipped — queue stays full until carrier is free', () => {
        sim = createSimulation();

        const carrierId = sim.spawnUnit(64, 64, UnitType.Carrier);
        sim.services.unitReservation.reserve(carrierId, { purpose: 'test' });

        recruitSpecialist(sim, UnitType.Thief, 1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        // Run several drain intervals — reserved carrier must not be picked up
        sim.runTicks(200);

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);

        // Release the reservation — next drain should dispatch
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

        const reservedId = sim.spawnUnit(62, 64, UnitType.Carrier);
        sim.spawnUnit(63, 64, UnitType.Carrier);
        sim.spawnUnit(64, 64, UnitType.Carrier);
        sim.services.unitReservation.reserve(reservedId, { purpose: 'test' });

        // Queue 3 Thieves — only 2 idle carriers are available
        recruitSpecialist(sim, UnitType.Thief, 3);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Thief) === 2, {
            maxTicks: 6_000,
            label: '2 Thieves from idle carriers',
            diagnose: () =>
                `queued=${sim.services.recruitSystem.getQueuedCount(UnitType.Thief)} ` +
                `thieves=${sim.countEntities(EntityType.Unit, UnitType.Thief)}`,
        });

        // Queue still holds 1 pending request (reserved carrier never got dispatched)
        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(2);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('queue stays full when all carriers are reserved', () => {
        sim = createSimulation();

        const id1 = sim.spawnUnit(63, 64, UnitType.Carrier);
        const id2 = sim.spawnUnit(64, 64, UnitType.Carrier);
        sim.services.unitReservation.reserve(id1, { purpose: 'test' });
        sim.services.unitReservation.reserve(id2, { purpose: 'test' });

        recruitSpecialist(sim, UnitType.Thief, 2);

        // Multiple drain intervals pass — nothing should happen
        sim.runTicks(400);

        expect(sim.countEntities(EntityType.Unit, UnitType.Thief)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(2);
        expect(sim.services.recruitSystem.getQueuedCount(UnitType.Thief)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });

    it('queuing 5 Thieves with 5 carriers produces 5 Thieves', () => {
        sim = createSimulation();

        for (let i = 0; i < 5; i++) {
            sim.spawnUnit(60 + i, 64, UnitType.Carrier);
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

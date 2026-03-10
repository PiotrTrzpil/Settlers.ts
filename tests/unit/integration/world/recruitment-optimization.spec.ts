/**
 * Integration tests for recruitment candidate optimization.
 *
 * Validates that RecruitSystem picks the best (carrier, tool) pair based on
 * total trip cost: carrier→tool + tool→target. Tests use explicit coordinates
 * via placeGoodsAt and spawnUnit to control distances precisely.
 *
 * Edge cases:
 *   1. Carrier nearest to tool beats carrier nearest to building
 *   2. Total trip optimization: carrier→tool + tool→target cost minimization
 *   3. No tool pile available → recruitment fails gracefully
 *   4. Multiple tool piles — nearest to carrier is selected
 *   5. Construction-demand buildJob continuation through dispatchRecruitment
 */

import { describe, it, expect, afterEach } from 'vitest';
import { type Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';

const hasRealData = installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function recruitSpecialist(sim: Simulation, unitType: UnitType, count: number, player = 0) {
    return sim.execute({ type: 'recruit_specialist', unitType, count, player, race: Race.Roman });
}

function findUnit(sim: Simulation, unitType: UnitType, player = 0): number | null {
    for (const e of sim.state.entities) {
        if (e.type === EntityType.Unit && e.subType === unitType && e.player === player) {
            return e.id;
        }
    }
    return null;
}

function diagnose(sim: Simulation, unitType: UnitType): string {
    return (
        `workers=${sim.countEntities(EntityType.Unit, unitType)} ` +
        `carriers=${sim.countEntities(EntityType.Unit, UnitType.Carrier)} ` +
        `pending=${sim.services.unitTransformer.getPendingCountByType(unitType)} ` +
        `queued=${sim.services.recruitSystem.getQueuedCount(unitType)}`
    );
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!hasRealData)('Recruitment optimization (integration)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ─── 1. Carrier nearest to tool wins, not carrier nearest to building ─────

    it('selects carrier nearest to tool pile, not nearest to building', () => {
        sim = createSimulation();

        // Layout (1D for clarity):
        //   carrierA at (30, 64) — far from tool (50,64), close to building (20,64)
        //   carrierB at (48, 64) — close to tool (50,64), far from building (20,64)
        //   tool pile at (50, 64)
        //   building at (20, 64)
        //
        // carrierA→tool = 20, carrierB→tool = 2
        // If system picked carrier nearest to building: carrierA (dist=10)
        // Correct: carrierB (closer to tool → shorter total trip)

        const carrierA = sim.spawnUnit(30, 64, UnitType.Carrier);
        const carrierB = sim.spawnUnit(48, 64, UnitType.Carrier);
        sim.placeGoodsAt(50, 64, EMaterialType.AXE, 1);

        // Place a WoodcutterHut at a known position (no worker spawned)
        sim.placeBuildingAt(20, 64, BuildingType.WoodcutterHut, 0, true, Race.Roman, false);

        // Run until a Woodcutter appears
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Woodcutter) === 1, {
            maxTicks: 30_000,
            label: 'Woodcutter recruited',
            diagnose: () => diagnose(sim, UnitType.Woodcutter),
        });

        // carrierB should have been recruited (closer to tool pile)
        // carrierA should still be a carrier
        const carrierAEntity = sim.state.getEntity(carrierA);
        const carrierBEntity = sim.state.getEntity(carrierB);

        // carrierB was transformed → entity still exists but type changed
        // carrierA should still be a Carrier
        expect(carrierAEntity?.subType).toBe(UnitType.Carrier);
        // carrierB should now be a Woodcutter (or no longer exist as carrier)
        expect(carrierBEntity?.subType).toBe(UnitType.Woodcutter);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── 2. Total trip cost minimization (carrier→tool + tool→target) ─────────

    it('minimizes total carrier→tool + tool→target distance', () => {
        sim = createSimulation();

        // Layout:
        //   carrierA at (30, 64) — tool at (32, 64) → carrier→tool=2, tool→target(20,64)=12 → total=14
        //   carrierB at (48, 64) — tool at (50, 64) → carrier→tool=2, tool→target(20,64)=30 → total=32
        //   Two tool piles: one at (32,64), one at (50,64)
        //   Building target at (20, 64)
        //
        // Both carriers are equally close to their respective tool piles (dist=2),
        // but carrierA's tool is closer to the target → lower total trip cost.
        // System should pick carrierA.

        const carrierA = sim.spawnUnit(30, 64, UnitType.Carrier);
        const carrierB = sim.spawnUnit(48, 64, UnitType.Carrier);
        sim.placeGoodsAt(32, 64, EMaterialType.AXE, 1);
        sim.placeGoodsAt(50, 64, EMaterialType.AXE, 1);

        sim.placeBuildingAt(20, 64, BuildingType.WoodcutterHut, 0, true, Race.Roman, false);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Woodcutter) === 1, {
            maxTicks: 30_000,
            label: 'Woodcutter recruited (trip cost)',
            diagnose: () => diagnose(sim, UnitType.Woodcutter),
        });

        // carrierA should be recruited (lower total trip cost)
        const carrierAEntity = sim.state.getEntity(carrierA);
        const carrierBEntity = sim.state.getEntity(carrierB);

        expect(carrierAEntity?.subType).toBe(UnitType.Woodcutter);
        expect(carrierBEntity?.subType).toBe(UnitType.Carrier);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── 3. No tool pile → recruitment fails gracefully ──────────────────────

    it('recruitment fails gracefully when no tool pile exists (carrier stays idle)', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 64, UnitType.Carrier);
        // No AXE pile placed — Woodcutter needs AXE

        // Use auto-placement to avoid occupancy conflicts
        sim.placeBuilding(BuildingType.WoodcutterHut, 0, true, undefined, false);

        // Run many drain cycles — no tool pile, so no recruitment should happen
        sim.runTicks(500);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.errors).toHaveLength(0);

        // Now place an AXE pile — demand should be fulfilled
        sim.placeGoods(EMaterialType.AXE, 1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Woodcutter) === 1, {
            maxTicks: 30_000,
            label: 'Woodcutter after tool placed',
            diagnose: () => diagnose(sim, UnitType.Woodcutter),
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── 4. Multiple tool piles — nearest to carrier wins ─────────────────────

    it('selects nearest tool pile to carrier among multiple piles', () => {
        sim = createSimulation();

        // Layout:
        //   carrier at (40, 64)
        //   tool pile A at (42, 64) — distance 2
        //   tool pile B at (60, 64) — distance 20
        //
        // Carrier should pick up from pile A (nearest).

        sim.spawnUnit(40, 64, UnitType.Carrier);
        const pileA = sim.placeGoodsAt(42, 64, EMaterialType.PICKAXE, 1);
        sim.placeGoodsAt(60, 64, EMaterialType.PICKAXE, 1);

        recruitSpecialist(sim, UnitType.Geologist, 1);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
            maxTicks: 30_000,
            label: 'Geologist from nearest pile',
            diagnose: () => diagnose(sim, UnitType.Geologist),
        });

        // Pile A should have been consumed (nearest to carrier)
        const pileAEntity = sim.state.getEntity(pileA);
        expect(pileAEntity).toBeUndefined();
        // Pile B should still exist
        expect(
            sim.state.entities.filter(
                e => e.type === EntityType.StackedPile && e.subType === (EMaterialType.PICKAXE as number)
            )
        ).toHaveLength(1);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── 5. Player-queued recruitment picks nearest tool with hint ──────────────

    it('player-queued recruitment uses camera hint to pick nearest tool pile', () => {
        sim = createSimulation();

        // Layout:
        //   carrier at (40, 64)
        //   pickaxe pile A at (20, 64) — near camera hint (18, 64)
        //   pickaxe pile B at (60, 64) — far from camera hint
        //
        // With hint at (18, 64), system finds tool nearest to hint (pile A),
        // then carrier nearest to that tool.

        sim.spawnUnit(40, 64, UnitType.Carrier);
        const pileA = sim.placeGoodsAt(20, 64, EMaterialType.PICKAXE, 1);
        sim.placeGoodsAt(60, 64, EMaterialType.PICKAXE, 1);

        // Use recruit_specialist command with camera hint
        sim.execute({
            type: 'recruit_specialist',
            unitType: UnitType.Geologist,
            count: 1,
            player: 0,
            race: Race.Roman,
            nearX: 18,
            nearY: 64,
        });

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
            maxTicks: 30_000,
            label: 'Geologist from hint-nearest pile',
            diagnose: () => diagnose(sim, UnitType.Geologist),
        });

        // Pile A (near hint) should have been consumed
        const pileAEntity = sim.state.getEntity(pileA);
        expect(pileAEntity).toBeUndefined();
        // Pile B should still exist
        expect(
            sim.state.entities.filter(
                e => e.type === EntityType.StackedPile && e.subType === (EMaterialType.PICKAXE as number)
            )
        ).toHaveLength(1);
        expect(sim.errors).toHaveLength(0);
    });
});

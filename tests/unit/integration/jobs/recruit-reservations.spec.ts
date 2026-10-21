/**
 * Recruit source reservations end with the job that holds them.
 *
 * A carrier walking to its transform holds a reservation on its source: a tool pile, or the
 * materials on a building (barracks). The reservation is keyed by the carrier and released by
 * the TRANSFORM_* node's abort hook — on failure, preemption, owner cancel and unit removal
 * alike — so no path can leak it. Before the hooks, a failed building recruit (barracks
 * training preempted on its way) kept its materials reserved forever.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';
import { TrainingRecipeIndex } from '@/game/features/barracks/training-recipes';
import { choreo, type SettlerTaskExports } from '@/game/features/settler-tasks';
import type { RecruitExports } from '@/game/features/recruit';

installRealGameData();

const ONE_SWORD = [{ material: EMaterialType.SWORD, count: 1 }] as const;

function recruit(sim: Simulation): RecruitExports {
    return sim.services.getFeature<RecruitExports>('recruit');
}

/** Barracks with exactly one sword in its input; runs until a carrier is on its way to train. */
function barracksTrainingStarted(sim: Simulation): { barracksId: number; carrierId: number } {
    sim.placeBuilding(BuildingType.ResidenceSmall);
    const barracksId = sim.placeBuilding(BuildingType.Barrack);
    sim.spawnUnitNear(barracksId, UnitType.Carrier, 3);
    sim.injectInput(barracksId, EMaterialType.SWORD, 1);
    let carrierId: number | null = null;
    sim.eventBus.on('barracks:trainingStarted', e => {
        carrierId ??= e.unitId;
    });
    sim.execute({
        type: 'add_to_production_queue',
        buildingId: barracksId,
        recipeIndex: TrainingRecipeIndex.SwordsmanL1,
    });
    sim.runUntil(() => carrierId !== null, { maxTicks: 5_000, label: 'barracks training started' });
    expect(recruit(sim).toolSourceResolver.hasBuildingMaterials(barracksId, ONE_SWORD, 'input')).toBe(false);
    return { barracksId, carrierId: carrierId! };
}

/** Player-queued geologist with one pickaxe; runs until the carrier walks to the pile. */
function geologistRecruitStarted(sim: Simulation): { carrierId: number } {
    sim.spawnUnit({ x: 64, y: 64 }, UnitType.Carrier);
    sim.spawnUnit({ x: 66, y: 64 }, UnitType.Carrier);
    sim.placeGoods(EMaterialType.PICKAXE, 1);
    sim.execute({ type: 'recruit_specialist', unitType: UnitType.Geologist, count: 1, player: 0, race: Race.Roman });
    const { unitTransformer } = recruit(sim);
    sim.runUntil(() => unitTransformer.getPendingCountByType(UnitType.Geologist) === 1, {
        maxTicks: 3_000,
        label: 'geologist recruit dispatched',
    });
    const carrierId = sim.state.entities.find(e => unitTransformer.isPending(e.id))!.id;
    return { carrierId };
}

/** Pickaxe pile is free again: a second geologist request gets recruited from it. */
function expectPickaxeReusable(sim: Simulation): void {
    const { unitTransformer } = recruit(sim);
    expect(unitTransformer.getPendingCountByType(UnitType.Geologist)).toBe(0);
    sim.execute({ type: 'recruit_specialist', unitType: UnitType.Geologist, count: 1, player: 0, race: Race.Roman });
    sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
        maxTicks: 30_000,
        label: 'geologist recruited from the released pile',
    });
}

/** Preempt the unit with an unrelated job (its current job fails as 'preempted'). */
function preempt(sim: Simulation, unitId: number): void {
    sim.services.jobRunner.assignJob(unitId, choreo('TEST_PREEMPT').wait(1).build());
}

describe('Recruit source reservations', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('barracks recruit failing before the transform releases the building materials', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });
        const { barracksId, carrierId } = barracksTrainingStarted(sim);

        preempt(sim, carrierId);

        expect(recruit(sim).toolSourceResolver.hasBuildingMaterials(barracksId, ONE_SWORD, 'input')).toBe(true);
        expect(recruit(sim).unitTransformer.isPending(carrierId)).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('barracks recruit killed before the transform releases the building materials', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });
        const { barracksId, carrierId } = barracksTrainingStarted(sim);

        sim.killUnit(carrierId);

        expect(recruit(sim).toolSourceResolver.hasBuildingMaterials(barracksId, ONE_SWORD, 'input')).toBe(true);
        expect(recruit(sim).unitTransformer.isPending(carrierId)).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('pile recruit failing before the transform releases the tool pile', () => {
        sim = createSimulation();
        const { carrierId } = geologistRecruitStarted(sim);

        preempt(sim, carrierId);

        expectPickaxeReusable(sim);
        expect(sim.errors).toHaveLength(0);
    });

    it('pile recruit killed before the transform releases the tool pile', () => {
        sim = createSimulation();
        const { carrierId } = geologistRecruitStarted(sim);

        sim.killUnit(carrierId);

        expectPickaxeReusable(sim);
        expect(sim.errors).toHaveLength(0);
    });

    it('pile recruit cancelled by its owner releases the tool pile', () => {
        sim = createSimulation();
        const { carrierId } = geologistRecruitStarted(sim);
        const { jobs } = sim.services.getFeature<SettlerTaskExports>('settler-tasks');

        jobs.cancel(carrierId, jobs.commitments.get(carrierId)!.owner);

        expectPickaxeReusable(sim);
        expect(sim.errors).toHaveLength(0);
    });
});

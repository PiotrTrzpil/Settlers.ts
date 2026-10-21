/**
 * Barracks job ownership — a training carrier runs an owned `Barracks` job (walk to the door,
 * TRANSFORM_RECRUIT_BUILDING, WAIT(FIGHT)); docs/designs/job-ownership.md, "Barracks migration".
 *
 * Covers: commitment while walking; carrier killed / job preempted before the transform (the
 * barracks used to stay "training" forever — now it emits trainingInterrupted and trains the next
 * recipe; the interrupted recipe stays consumed); save mid-walk and mid-FIGHT-wait (training
 * completes exactly once, no double transform); barracks removed mid-walk.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { JobKind } from '@/game/systems/choreo';
import { TrainingRecipeIndex, type BarracksExports, type BarracksTrainingManager } from '@/game/features/barracks';

installRealGameData();

const MAP = { mapWidth: 128, mapHeight: 128 } as const;

function manager(sim: Simulation): BarracksTrainingManager {
    return sim.services.getFeature<BarracksExports>('barracks').barracksTrainingManager;
}

interface TrainingLog {
    started: number[];
    completed: number[];
    interrupted: string[];
    recruited: number[];
}

function trackTraining(sim: Simulation): TrainingLog {
    const log: TrainingLog = { started: [], completed: [], interrupted: [], recruited: [] };
    sim.eventBus.on('barracks:trainingStarted', e => log.started.push(e.unitId));
    sim.eventBus.on('barracks:trainingCompleted', e => log.completed.push(e.unitId));
    sim.eventBus.on('barracks:trainingInterrupted', e => log.interrupted.push(e.reason));
    sim.eventBus.on('unit:recruited', e => log.recruited.push(e.unitId));
    return log;
}

/** Barracks with `swords` swords in its input and `queued` SwordsmanL1 recipes; carriers nearby. */
function setupBarracks(sim: Simulation, swords: number, queued: number): number {
    sim.placeBuilding(BuildingType.ResidenceSmall);
    const barracksId = sim.placeBuilding(BuildingType.Barrack);
    sim.spawnUnitNear(barracksId, UnitType.Carrier, 4);
    sim.injectInput(barracksId, EMaterialType.SWORD, swords);
    for (let i = 0; i < queued; i++) {
        sim.execute({
            type: 'add_to_production_queue',
            buildingId: barracksId,
            recipeIndex: TrainingRecipeIndex.SwordsmanL1,
        });
    }
    return barracksId;
}

function runUntilStarted(sim: Simulation, log: TrainingLog, count: number): number {
    sim.runUntil(() => log.started.length >= count, { maxTicks: 5_000, label: `training #${count} started` });
    return log.started[count - 1]!;
}

function runUntilCompleted(sim: Simulation, log: TrainingLog, count: number): void {
    sim.runUntil(() => log.completed.length >= count, {
        maxTicks: 20_000,
        label: `${count} trainings completed`,
        diagnose: () => `log=${JSON.stringify(log)}, errors=${sim.errors.length}`,
    });
}

describe('Barracks job ownership', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        restored?.destroy();
        restored = undefined;
        sim?.destroy();
        cleanupSimulation();
    });

    it('a training carrier runs a reserved Barracks job owned by its barracks', () => {
        sim = createSimulation(MAP);
        const barracksId = setupBarracks(sim, 1, 1);
        const log = trackTraining(sim);
        const carrierId = runUntilStarted(sim, log, 1);

        expect(sim.services.unitCommitments.get(carrierId)).toEqual({
            owner: JobKind.Barracks,
            ref: barracksId,
            reserved: true,
            hasJob: true,
        });
        expect(manager(sim).getTrainingState(barracksId)!.carrierId).toBe(carrierId);

        runUntilCompleted(sim, log, 1);
        expect(log.completed).toEqual([carrierId]);
        expect(sim.countEntities(EntityType.Unit, UnitType.Swordsman1)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('carrier killed on its way: training interrupted, recipe stays consumed, the next recipe trains', () => {
        sim = createSimulation(MAP);
        const barracksId = setupBarracks(sim, 2, 2);
        const log = trackTraining(sim);
        const first = runUntilStarted(sim, log, 1);

        sim.killUnit(first);

        expect(log.interrupted).toEqual(['carrier_killed']);
        expect(manager(sim).isTraining(barracksId)).toBe(false);

        const second = runUntilStarted(sim, log, 2);
        expect(second).not.toBe(first);
        runUntilCompleted(sim, log, 1);
        expect(log.completed).toEqual([second]);
        // Both queued recipes were consumed — the killed carrier's one is not retried.
        sim.runTicks(500);
        expect(log.started).toHaveLength(2);
        expect(sim.countEntities(EntityType.Unit, UnitType.Swordsman1)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('job failing before the transform interrupts the training; the barracks trains again', () => {
        sim = createSimulation(MAP);
        const barracksId = setupBarracks(sim, 2, 2);
        const log = trackTraining(sim);
        const first = runUntilStarted(sim, log, 1);

        const carrier = sim.state.getEntityOrThrow(first, 'training carrier');
        expect(sim.services.jobRunner.assignMoveTask(first, { x: carrier.x + 2, y: carrier.y })).toBe(true);

        expect(log.interrupted).toEqual(['preempted']);
        expect(manager(sim).isTraining(barracksId)).toBe(false);
        runUntilCompleted(sim, log, 1);
        expect(log.completed).not.toContain(first);
        expect(sim.errors).toHaveLength(0);
    });

    it('saved mid-walk: training is restored and completes once', () => {
        sim = createSimulation(MAP);
        const barracksId = setupBarracks(sim, 1, 1);
        const log = trackTraining(sim);
        const carrierId = runUntilStarted(sim, log, 1);

        restored = sim.saveAndRestore(0);
        const after = trackTraining(restored);

        expect(manager(restored).getTrainingState(barracksId)!.carrierId).toBe(carrierId);
        expect(restored.services.unitCommitments.get(carrierId)!.owner).toBe(JobKind.Barracks);

        runUntilCompleted(restored, after, 1);
        restored.runTicks(300);
        expect(after.completed).toEqual([carrierId]);
        expect(after.recruited).toEqual([carrierId]);
        expect(after.started).toEqual([]);
        expect(restored.getInput(barracksId, EMaterialType.SWORD)).toBe(0);
        expect(restored.countEntities(EntityType.Unit, UnitType.Swordsman1)).toBe(1);
        expect(restored.services.unitCommitments.isIdle(carrierId)).toBe(true);
        expect(restored.errors).toHaveLength(0);
    });

    it('saved mid-FIGHT-wait: no second transform, no second completion, the job finishes', () => {
        sim = createSimulation(MAP);
        const barracksId = setupBarracks(sim, 2, 1);
        const log = trackTraining(sim);
        const carrierId = runUntilStarted(sim, log, 1);
        runUntilCompleted(sim, log, 1);
        expect(sim.services.unitCommitments.get(carrierId)!.owner).toBe(JobKind.Barracks);

        restored = sim.saveAndRestore(0);
        const after = trackTraining(restored);

        expect(manager(restored).isTraining(barracksId)).toBe(false);
        expect(restored.services.unitCommitments.get(carrierId)!.owner).toBe(JobKind.Barracks);

        restored.runUntil(() => restored!.services.unitCommitments.isIdle(carrierId), {
            maxTicks: 2_000,
            label: 'FIGHT wait finished',
        });
        restored.runTicks(300);
        expect(after.recruited).toEqual([]);
        expect(after.completed).toEqual([]);
        expect(after.interrupted).toEqual([]);
        expect(restored.getInput(barracksId, EMaterialType.SWORD)).toBe(1);
        expect(restored.countEntities(EntityType.Unit, UnitType.Swordsman1)).toBe(1);
        expect(restored.errors).toHaveLength(0);
    });

    it('barracks removed mid-walk: the carrier job is cancelled and the carrier idles', () => {
        sim = createSimulation(MAP);
        const barracksId = setupBarracks(sim, 1, 1);
        const log = trackTraining(sim);
        const carrierId = runUntilStarted(sim, log, 1);

        sim.removeBuilding(barracksId);

        expect(sim.services.unitCommitments.isIdle(carrierId)).toBe(true);
        sim.runTicks(300);
        expect(log.recruited).toEqual([]);
        expect(sim.state.getEntityOrThrow(carrierId, 'carrier').subType).toBe(UnitType.Carrier);
        expect(sim.errors).toHaveLength(0);
    });
});

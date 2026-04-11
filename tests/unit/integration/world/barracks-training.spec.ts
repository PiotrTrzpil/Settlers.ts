/**
 * Integration tests for barracks soldier training.
 *
 * Validates training across all three production modes (even, proportional, manual),
 * mixed unit types, and save/load persistence mid-training.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { BuildingType } from '@/game/buildings/building-type';
import { ProductionMode } from '@/game/features/production-control';
import { TrainingRecipeIndex } from '@/game/features/barracks/training-recipes';
import { createSimulation, cleanupSimulation, Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { restoreFromSnapshot } from '@/game/state/game-state-persistence';
import type { Game } from '@/game/game';
import type { Command } from '@/game/commands';

installRealGameData();

// ─── Helpers ─────────────────────────────────────────────────────

interface TrainedUnit {
    unitType: UnitType;
    level: number;
}

function trackTraining(sim: Simulation): { started: number[]; completed: TrainedUnit[] } {
    const started: number[] = [];
    const completed: TrainedUnit[] = [];
    sim.eventBus.on('barracks:trainingStarted', e => started.push(e.unitId));
    sim.eventBus.on('barracks:trainingCompleted', e => {
        completed.push({ unitType: e.unitType, level: e.soldierLevel });
    });
    return { started, completed };
}

function setMode(sim: Simulation, barracksId: number, mode: ProductionMode): void {
    sim.execute({ type: 'set_production_mode', buildingId: barracksId, mode });
}

function enqueue(sim: Simulation, barracksId: number, recipeIndex: number): void {
    sim.execute({ type: 'add_to_production_queue', buildingId: barracksId, recipeIndex });
}

function setProportion(sim: Simulation, barracksId: number, recipeIndex: number, weight: number): void {
    sim.execute({ type: 'set_recipe_proportion', buildingId: barracksId, recipeIndex, weight });
}

/** Set up barracks + storage + multiple residences for ample carriers. */
function setupBarracks(sim: Simulation): { barracksId: number; storageId: number } {
    const storageId = sim.placeBuilding(BuildingType.StorageArea);
    sim.placeBuilding(BuildingType.ResidenceMedium);
    sim.placeBuilding(BuildingType.ResidenceSmall);
    const barracksId = sim.placeBuilding(BuildingType.Barrack);
    return { barracksId, storageId };
}

/** Inject a full set of weapons/materials into the storage for barracks delivery. */
function stockAllWeapons(sim: Simulation, storageId: number, amount: number): void {
    sim.injectOutput(storageId, EMaterialType.SWORD, amount);
    sim.injectOutput(storageId, EMaterialType.BOW, amount);
    sim.injectOutput(storageId, EMaterialType.GOLDBAR, amount);
    sim.injectOutput(storageId, EMaterialType.ARMOR, amount);
}

function asGame(sim: Simulation): Game {
    return {
        state: sim.state,
        services: sim.services,
        terrain: sim.map.terrain,
        eventBus: sim.eventBus,
        execute: (cmd: Command) => sim.execute(cmd),
    } as unknown as Game;
}

/**
 * Snapshot + restore WITHOUT running replay ticks.
 * Allows attaching event listeners before any ticks run in the restored sim.
 */
function snapshotAndRestore(src: Simulation): Simulation {
    const snapshot = src.createSnapshot();
    const sim2 = new Simulation({ mapWidth: src.mapWidth, mapHeight: src.mapHeight });
    restoreFromSnapshot(asGame(sim2), snapshot);
    return sim2;
}

const REPLAY_TICKS = 300;

// ─── Even mode ───────────────────────────────────────────────────

describe('Barracks training — even mode', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('cycles through different unit types in round-robin order', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        setMode(sim, barracksId, ProductionMode.Even);

        // Provide all materials so the full recipe cycle works.
        // Even mode cycles 0–9: SwordsmanL1, L2, L3, BowmanL1, L2, L3, SquadLeader, SpecL1-L3.
        stockAllWeapons(sim, storageId, 20);

        sim.runUntil(() => completed.length >= 4, {
            maxTicks: 100_000,
            label: '4 soldiers in even mode',
            diagnose: () => `completed: ${JSON.stringify(completed)}, errors: ${sim.errors.length}`,
        });

        expect(sim.errors).toHaveLength(0);
        // First four in even order: SwordsmanL1, SwordsmanL2, SwordsmanL3, BowmanL1
        expect(completed[0]).toEqual({ unitType: UnitType.Swordsman1, level: 1 });
        expect(completed[1]).toEqual({ unitType: UnitType.Swordsman1, level: 2 });
        expect(completed[2]).toEqual({ unitType: UnitType.Swordsman1, level: 3 });
        expect(completed[3]).toEqual({ unitType: UnitType.Bowman1, level: 1 });
    });

    it('idles when current recipe inputs are unavailable', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        setMode(sim, barracksId, ProductionMode.Even);

        // Only provide swords — no gold, so even mode trains SwordsmanL1 (index 0)
        // then gets stuck on SwordsmanL2 (index 1, needs gold).
        sim.injectOutput(storageId, EMaterialType.SWORD, 5);

        sim.runUntil(() => completed.length >= 1, {
            maxTicks: 50_000,
            label: '1 swordsman trained',
            diagnose: () => `completed: ${completed.length}, errors: ${sim.errors.length}`,
        });

        // After first training, barracks should idle (stuck on SwordsmanL2)
        const countAfterFirst = completed.length;
        sim.runTicks(5000);

        expect(sim.errors).toHaveLength(0);
        expect(countAfterFirst).toBe(1);
        expect(completed.length).toBe(1); // no more trained — still stuck
    });
});

// ─── Proportional mode ───────────────────────────────────────────

describe('Barracks training — proportional mode', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('favors higher-weighted recipe', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        setMode(sim, barracksId, ProductionMode.Proportional);
        // Disable all recipes except SwordsmanL1 and BowmanL1
        for (let i = 0; i < 10; i++) setProportion(sim, barracksId, i, 0);
        setProportion(sim, barracksId, TrainingRecipeIndex.SwordsmanL1, 1);
        setProportion(sim, barracksId, TrainingRecipeIndex.BowmanL1, 3);

        sim.injectOutput(storageId, EMaterialType.SWORD, 15);
        sim.injectOutput(storageId, EMaterialType.BOW, 15);

        sim.runUntil(() => completed.length >= 8, {
            maxTicks: 150_000,
            label: '8 soldiers in proportional mode',
            diagnose: () => `completed: ${JSON.stringify(completed)}, errors: ${sim.errors.length}`,
        });

        expect(sim.errors).toHaveLength(0);
        const swords = completed.filter(u => u.unitType === UnitType.Swordsman1).length;
        const bows = completed.filter(u => u.unitType === UnitType.Bowman1).length;
        // With 3:1 weighting and 8+ trained, bowmen should outnumber swordsmen
        expect(bows).toBeGreaterThan(swords);
    });
});

// ─── Manual mode ─────────────────────────────────────────────────

describe('Barracks training — manual mode', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('trains units in exact queue order', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        // Default mode is Manual
        enqueue(sim, barracksId, TrainingRecipeIndex.BowmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);

        sim.injectOutput(storageId, EMaterialType.BOW, 5);
        sim.injectOutput(storageId, EMaterialType.SWORD, 5);

        sim.runUntil(() => completed.length >= 3, {
            maxTicks: 80_000,
            label: '3 soldiers in manual queue order',
            diagnose: () => `completed: ${JSON.stringify(completed)}, errors: ${sim.errors.length}`,
        });

        expect(sim.errors).toHaveLength(0);
        expect(completed).toEqual([
            { unitType: UnitType.Bowman1, level: 1 },
            { unitType: UnitType.Swordsman1, level: 1 },
            { unitType: UnitType.Swordsman1, level: 1 },
        ]);
    });

    it('trains L2 and L3 soldiers when gold is available', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL2);
        enqueue(sim, barracksId, TrainingRecipeIndex.BowmanL3);

        sim.injectOutput(storageId, EMaterialType.SWORD, 5);
        sim.injectOutput(storageId, EMaterialType.BOW, 5);
        sim.injectOutput(storageId, EMaterialType.GOLDBAR, 5);

        sim.runUntil(() => completed.length >= 2, {
            maxTicks: 80_000,
            label: 'L2 swordsman + L3 bowman',
            diagnose: () => `completed: ${JSON.stringify(completed)}, errors: ${sim.errors.length}`,
        });

        expect(sim.errors).toHaveLength(0);
        expect(completed).toEqual([
            { unitType: UnitType.Swordsman1, level: 2 },
            { unitType: UnitType.Bowman1, level: 3 },
        ]);
        expect(sim.countEntities(EntityType.Unit, UnitType.Swordsman2)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Bowman3)).toBe(1);
    });

    it('idles when queue is empty, resumes when items are enqueued', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        sim.injectOutput(storageId, EMaterialType.SWORD, 10);

        // Empty queue (manual default) — barracks should idle
        sim.runTicks(3000);
        expect(completed).toHaveLength(0);

        // Now enqueue two swordsmen — training should start
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);

        sim.runUntil(() => completed.length >= 2, {
            maxTicks: 80_000,
            label: 'soldiers after queue populated',
            diagnose: () => `completed: ${completed.length}, errors: ${sim.errors.length}`,
        });

        expect(sim.errors).toHaveLength(0);
        expect(completed).toHaveLength(2);
    });

    it('trains squad leader requiring sword + armor', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);
        const { completed } = trackTraining(sim);

        enqueue(sim, barracksId, TrainingRecipeIndex.SquadLeader);

        sim.injectOutput(storageId, EMaterialType.SWORD, 5);
        sim.injectOutput(storageId, EMaterialType.ARMOR, 5);

        sim.runUntil(() => completed.length >= 1, {
            maxTicks: 80_000,
            label: 'squad leader trained',
            diagnose: () => `completed: ${JSON.stringify(completed)}, errors: ${sim.errors.length}`,
        });

        expect(sim.errors).toHaveLength(0);
        expect(completed[0]).toEqual({ unitType: UnitType.SquadLeader, level: 1 });
        expect(sim.countEntities(EntityType.Unit, UnitType.SquadLeader)).toBe(1);
    });
});

// ─── Save/load persistence ───────────────────────────────────────

describe('Barracks training — save/load persistence', { timeout: 90_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        restored?.destroy();
        sim?.destroy();
        cleanupSimulation();
    });

    it('resumes training after save+reload when carrier is walking to barracks', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);

        let started = 0;
        sim.eventBus.on('barracks:trainingStarted', () => started++);

        // Manual mode: queue several swordsmen so barracks stays active after restore
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);

        stockAllWeapons(sim, storageId, 20);

        // Run until training starts (carrier dispatched but may not have arrived)
        sim.runUntil(() => started >= 1, {
            maxTicks: 50_000,
            label: 'first training started',
            diagnose: () => `started: ${started}, errors: ${sim.errors.length}`,
        });

        // Save + restore — attach listener before replay ticks so we capture everything
        restored = snapshotAndRestore(sim);

        const restoredCompleted: TrainedUnit[] = [];
        restored.eventBus.on('barracks:trainingCompleted', e => {
            restoredCompleted.push({ unitType: e.unitType, level: e.soldierLevel });
        });

        restored.runTicks(REPLAY_TICKS);

        // After restore, barracks should eventually produce soldiers from remaining queue
        restored.runUntil(() => restoredCompleted.length >= 1, {
            maxTicks: 100_000,
            label: 'soldier after restore',
            diagnose: () => `restored completed: ${restoredCompleted.length}, errors: ${restored!.errors.length}`,
        });

        expect(restored.errors).toHaveLength(0);
        expect(restoredCompleted.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves manual queue across save+reload', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);

        // Queue 5 items, train some, then save. The queue pops items as soon as
        // training *starts* (not completes), so in-flight items are already consumed.
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.BowmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.BowmanL1);
        enqueue(sim, barracksId, TrainingRecipeIndex.SwordsmanL1);

        stockAllWeapons(sim, storageId, 20);

        let completedCount = 0;
        sim.eventBus.on('barracks:trainingCompleted', () => completedCount++);

        // Wait for 2 completions, so queue has consumed 3 (2 done + 1 in-flight).
        // Remaining queue after save: [BowmanL1, SwordsmanL1]
        sim.runUntil(() => completedCount >= 2, {
            maxTicks: 80_000,
            label: '2 soldiers before save',
            diagnose: () => `completed: ${completedCount}, errors: ${sim.errors.length}`,
        });

        // Save + restore — attach listener before replay ticks
        restored = snapshotAndRestore(sim);

        const restoredCompleted: TrainedUnit[] = [];
        restored.eventBus.on('barracks:trainingCompleted', e => {
            restoredCompleted.push({ unitType: e.unitType, level: e.soldierLevel });
        });

        restored.runTicks(REPLAY_TICKS);

        // The in-flight training is lost (transient state), but remaining queue items
        // should eventually train. At least 1 should complete from the remaining queue.
        restored.runUntil(() => restoredCompleted.length >= 1, {
            maxTicks: 100_000,
            label: 'soldiers after restore from remaining queue',
            diagnose: () =>
                `restored completed: ${JSON.stringify(restoredCompleted)}, errors: ${restored!.errors.length}`,
        });

        expect(restored.errors).toHaveLength(0);
        expect(restoredCompleted.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves production mode and proportions across save+reload', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });
        const { barracksId, storageId } = setupBarracks(sim);

        setMode(sim, barracksId, ProductionMode.Proportional);
        for (let i = 0; i < 10; i++) setProportion(sim, barracksId, i, 0);
        setProportion(sim, barracksId, TrainingRecipeIndex.BowmanL1, 5);

        sim.injectOutput(storageId, EMaterialType.BOW, 20);

        // Train 1 bowman, then save
        const { completed } = trackTraining(sim);
        sim.runUntil(() => completed.length >= 1, {
            maxTicks: 80_000,
            label: '1 bowman before save',
            diagnose: () => `completed: ${completed.length}, errors: ${sim.errors.length}`,
        });

        restored = snapshotAndRestore(sim);

        // After restore, should still be proportional mode favoring bows
        const restoredCompleted: TrainedUnit[] = [];
        restored.eventBus.on('barracks:trainingCompleted', e => {
            restoredCompleted.push({ unitType: e.unitType, level: e.soldierLevel });
        });

        restored.runTicks(REPLAY_TICKS);

        restored.runUntil(() => restoredCompleted.length >= 2, {
            maxTicks: 100_000,
            label: '2 bowmen after restore',
            diagnose: () =>
                `restored completed: ${JSON.stringify(restoredCompleted)}, errors: ${restored!.errors.length}`,
        });

        expect(restored.errors).toHaveLength(0);
        // All should be bowmen since only BowmanL1 has weight > 0
        for (const u of restoredCompleted) {
            expect(u.unitType).toBe(UnitType.Bowman1);
        }
    });
});

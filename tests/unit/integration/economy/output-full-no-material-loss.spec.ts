/**
 * Regression test: when a building's output slot is full, the worker
 * should wait instead of producing and silently losing the material.
 *
 * Bug: PUT_GOOD deposited output, got 0 back (full), logged a warning,
 * but cleared the settler's carrying state — material vanished.
 *
 * Expected: worker waits at home when output is full, resumes when
 * output is picked up by a carrier.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';

installRealGameData();

describe('Output full — no material loss', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('sawmill does not lose material when output is full', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Fill output slot to capacity (8 BOARDs)
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 8);
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(8);

        // Inject input — worker will try to produce but output is full
        sim.injectInput(sawmillId, EMaterialType.LOG, 3);

        // Run for a while — worker should wait, not produce and lose material
        sim.runTicks(120 * 30);

        // Output should still be exactly 8 (not more, not less)
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(8);
        // Input should be untouched — worker never started production
        expect(sim.getInput(sawmillId, EMaterialType.LOG)).toBe(3);
    });

    it('sawmill does not lose material when output fills mid-production', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Output almost full (7/8) — worker will start because there's 1 slot free
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 7);
        sim.injectInput(sawmillId, EMaterialType.LOG, 3);

        // Run long enough for at least 1 production cycle
        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 8, { maxTicks: 300 * 30 });

        // After filling to 8, no further production should happen.
        // Material invariant: input consumed + output produced must balance.
        // With 7 initial boards and 3 logs, after producing 1 board (filling to 8)
        // the remaining 2 logs must stay as input (not be consumed and lost).
        sim.runTicks(120 * 30);
        const boards = sim.getOutput(sawmillId, EMaterialType.BOARD);
        const logsRemaining = sim.getInput(sawmillId, EMaterialType.LOG);
        expect(boards).toBe(8);
        // The 2 remaining logs must not have been consumed and lost
        expect(logsRemaining).toBe(2);
    });

    /**
     * Regression: isOutputFull used findSlot() which only returns slots with
     * space (currentAmount < maxCapacity). A full slot returned undefined,
     * so isOutputFull always returned false for free workers like woodcutters.
     * Fix: use findOutputSlot() which matches by material+kind without capacity filter.
     */
    it('woodcutter does not cut trees when LOG output is full', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        // Fill output to capacity
        sim.injectOutput(woodcutterId, EMaterialType.LOG, 8);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(8);

        // Plant trees — woodcutter should NOT cut them while output is full
        const treeCount = sim.plantTreesNear(woodcutterId, 5);

        sim.runTicks(120 * 30);

        // Output unchanged, trees untouched
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(8);
        expect(sim.countNearbyTrees(woodcutterId)).toBe(treeCount);
    });

    it('sawmill resumes production after output is cleared', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Fill output to capacity, add input
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 8);
        sim.injectInput(sawmillId, EMaterialType.LOG, 2);

        // Run — worker should wait
        sim.runTicks(60 * 30);
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(8);
        expect(sim.getInput(sawmillId, EMaterialType.LOG)).toBe(2);

        // Clear some output space — withdraw 4 boards
        sim.services.inventoryManager.withdrawOutput(sawmillId, EMaterialType.BOARD, 4);
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(4);

        // Worker should now resume and produce up to 2 boards
        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 6, { maxTicks: 300 * 30 });
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(6);
        expect(sim.getInput(sawmillId, EMaterialType.LOG)).toBe(0);
    });
});

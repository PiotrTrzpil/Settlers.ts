/**
 * Headless economy simulation — runs the full production pipeline
 * without a browser using real XML game data. Asserts on observable
 * outcomes only: inventory counts, entity existence, material flow.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../helpers/test-simulation';
import { installRealGameData } from '../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';

const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Economy simulation (real game data)', () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('woodcutter produces exactly as many logs as nearby trees', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        // 3 nearby trees (within working radius) + 5 far trees (outside working radius)
        sim.plantTreesNear(woodcutterId, 3);
        sim.plantTreesFar(woodcutterId, 5);

        // Wait for all 3 nearby trees to be cut, then run extra ticks to confirm no more appear
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });
        sim.runTicks(60 * 30); // idle for ~60 more seconds — should NOT produce a 4th log
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(3);
    });

    it('carrier delivers logs from woodcutter to sawmill', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        sim.plantTreesNear(woodcutterId, 5);

        // Wait for at least one log to arrive at the sawmill input
        sim.runUntil(() => sim.getInput(sawmillId, EMaterialType.LOG) >= 1, { maxTicks: 120 * 30 });

        expect(sim.getInput(sawmillId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);
        // Sawmill should also be consuming logs to produce boards
        const totalLogs = sim.getOutput(woodcutterId, EMaterialType.LOG) + sim.getInput(sawmillId, EMaterialType.LOG);
        expect(totalLogs).toBeGreaterThanOrEqual(1);
    });

    it('woodcutter → sawmill chain produces boards', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Verify units were auto-spawned (carriers + workers)
        expect(sim.countEntities(EntityType.Unit)).toBeGreaterThanOrEqual(3);

        sim.plantTreesNear(woodcutterId, 5);

        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 1, { maxTicks: 180 * 30 });

        // Full chain validated: tree → log → carrier delivery → board
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
    });

    it('multiple production cycles accumulate output', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.plantTreesNear(woodcutterId, 10);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });

        // Worker should loop: cut tree → deposit → find next tree → repeat
        const logs = sim.getOutput(woodcutterId, EMaterialType.LOG);
        expect(logs).toBeGreaterThanOrEqual(3);
        expect(logs).toBeLessThanOrEqual(10); // can't exceed total tree count
    });

    it('stonecutter mines stone from nearby rocks', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const stonecutterId = sim.placeBuilding(BuildingType.StonecutterHut);

        sim.placeStonesNear(stonecutterId, 3);

        sim.runUntil(() => sim.getOutput(stonecutterId, EMaterialType.STONE) >= 1, { maxTicks: 120 * 30 });

        expect(sim.getOutput(stonecutterId, EMaterialType.STONE)).toBeGreaterThanOrEqual(1);
    });
});

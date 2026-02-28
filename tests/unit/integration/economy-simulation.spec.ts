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

    it('woodcutter cuts only nearby trees, ignores far ones', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        // 3 reachable trees + 5 unreachable (beyond working area radius)
        sim.plantTreesNear(woodcutterId, 3);
        sim.plantTreesFar(woodcutterId, 5);

        // Wait for all 3 nearby trees, then keep running to confirm no 4th log appears
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(3);
    });

    it('full production chain: trees → woodcutter → carrier → sawmill → boards', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Auto-spawned units: woodcutter worker, sawmill worker, carriers
        expect(sim.countEntities(EntityType.Unit)).toBeGreaterThanOrEqual(3);

        sim.plantTreesNear(woodcutterId, 5);

        // Wait for all 5 trees to become boards (1 tree → 1 log → 1 board), then idle
        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 5, { maxTicks: 500 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(5);
    });

    it('worker loops back to cut all nearby trees', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.plantTreesNear(woodcutterId, 5);

        // Wait for all 5, then extra idle to confirm no phantom production
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 5, { maxTicks: 500 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(5);
    });

    it('stonecutter mines only nearby rocks, ignores far ones', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const stonecutterId = sim.placeBuilding(BuildingType.StonecutterHut);

        // 2 reachable rocks + 3 unreachable (beyond working area radius)
        // Each rock has multiple depletion stages, yielding several stones
        sim.placeStonesNear(stonecutterId, 2);
        sim.placeStonesFar(stonecutterId, 3);

        // Wait for production to stabilize, then run extra idle ticks
        sim.runUntil(() => sim.getOutput(stonecutterId, EMaterialType.STONE) >= 2, { maxTicks: 200 * 30 });
        const stonesAfterNearby = sim.getOutput(stonecutterId, EMaterialType.STONE);
        sim.runTicks(60 * 30);

        // Should not have produced more (far rocks are out of range)
        expect(sim.getOutput(stonecutterId, EMaterialType.STONE)).toBe(stonesAfterNearby);
    });
});

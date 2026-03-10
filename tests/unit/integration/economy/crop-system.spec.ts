/**
 * Integration tests for the crop lifecycle system.
 *
 * Tests all crop types (Grain, Sunflower, Agave, Beehive, Grape) using
 * the full simulation pipeline — farmer settlers plant, crops grow,
 * farmers harvest, and output material appears in building inventory.
 *
 * Each farm building has a dual-role worker: plants when no mature crops
 * exist, harvests when crops are ready. The crop system manages growth
 * timing, sprite stage transitions, and harvested-stub decay.
 *
 * Race-specific buildings require the correct player race:
 *   Roman: GrainFarm, Vinyard
 *   Viking: BeekeeperHut, MeadMakerHut
 *   Mayan: AgaveFarmerHut, TequilaMakerHut
 *   Trojan: SunflowerFarmerHut, SunflowerOilMakerHut
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';

const hasRealData = installRealGameData();

const SIM_256 = { mapWidth: 256, mapHeight: 256 } as const;

describe.skipIf(!hasRealData)('Crop system (real game data)', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ── Grain (Roman) ────────────────────────────────────────────

    it('grain farm: farmer plants grain, crops grow and are harvested → GRAIN output', () => {
        sim = createSimulation(SIM_256);

        let planted = 0;
        let matured = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:matured', () => matured++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        sim.runUntil(() => sim.getOutput(farmId, EMaterialType.GRAIN) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(farmId, EMaterialType.GRAIN)).toBeGreaterThanOrEqual(1);

        expect(planted).toBeGreaterThanOrEqual(1);
        expect(matured).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
        expect(matured).toBeGreaterThanOrEqual(harvested);
        expect(planted).toBeGreaterThanOrEqual(matured);
    });

    it('grain farm: farmer plants multiple crops and harvests them all', () => {
        sim = createSimulation(SIM_256);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        sim.runUntil(() => sim.getOutput(farmId, EMaterialType.GRAIN) >= 3, { maxTicks: 5000 * 30 });
        expect(sim.getOutput(farmId, EMaterialType.GRAIN)).toBeGreaterThanOrEqual(3);
    });

    // ── Sunflower (Trojan) ───────────────────────────────────────

    it('sunflower farm: farmer plants sunflowers → SUNFLOWER output', () => {
        sim = createSimulation({ ...SIM_256, race: Race.Trojan });

        let planted = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.SunflowerFarmerHut);

        sim.runUntil(() => sim.getOutput(farmId, EMaterialType.SUNFLOWER) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(farmId, EMaterialType.SUNFLOWER)).toBeGreaterThanOrEqual(1);

        expect(planted).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
    });

    // ── Agave (Mayan) ────────────────────────────────────────────

    it('agave farm: farmer plants agave → AGAVE output', () => {
        sim = createSimulation({ ...SIM_256, race: Race.Mayan });

        let planted = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.AgaveFarmerHut);

        sim.runUntil(() => sim.getOutput(farmId, EMaterialType.AGAVE) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(farmId, EMaterialType.AGAVE)).toBeGreaterThanOrEqual(1);

        expect(planted).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
    });

    // ── Beehive (Viking) ─────────────────────────────────────────

    it('beekeeper: plants beehives → HONEY output', () => {
        sim = createSimulation({ ...SIM_256, race: Race.Viking });

        let planted = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.BeekeeperHut);

        sim.runUntil(() => sim.getOutput(farmId, EMaterialType.HONEY) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(farmId, EMaterialType.HONEY)).toBeGreaterThanOrEqual(1);

        expect(planted).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
    });

    // ── Grape/Vine (Roman) ───────────────────────────────────────

    it('vineyard: winemaker plants vines, crops grow and are harvested → WINE output', () => {
        sim = createSimulation(SIM_256);

        let planted = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.Vinyard);

        sim.runUntil(() => sim.getOutput(farmId, EMaterialType.WINE) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(farmId, EMaterialType.WINE)).toBeGreaterThanOrEqual(1);

        expect(planted).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
    });

    // ── Crop lifecycle invariants ────────────────────────────────

    it('crop lifecycle invariant: planted ≥ matured ≥ harvested', () => {
        sim = createSimulation(SIM_256);

        const counts = new Map<string, { planted: number; matured: number; harvested: number }>();
        const ensureEntry = (type: string) => {
            if (!counts.has(type)) counts.set(type, { planted: 0, matured: 0, harvested: 0 });
            return counts.get(type)!;
        };

        sim.eventBus.on('crop:planted', e => ensureEntry(String(e.cropType)).planted++);
        sim.eventBus.on('crop:matured', e => ensureEntry(String(e.cropType)).matured++);
        sim.eventBus.on('crop:harvested', e => ensureEntry(String(e.cropType)).harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const grainId = sim.placeBuilding(BuildingType.GrainFarm);

        sim.runUntil(() => sim.getOutput(grainId, EMaterialType.GRAIN) >= 2, { maxTicks: 5000 * 30 });

        expect(counts.size).toBeGreaterThanOrEqual(1);
        for (const [, c] of counts) {
            expect(c.planted).toBeGreaterThanOrEqual(c.matured);
            expect(c.matured).toBeGreaterThanOrEqual(c.harvested);
        }
    });

    // ── Full production chains through crops ─────────────────────

    it('full chain: grain farm → grain → mill → flour', () => {
        sim = createSimulation(SIM_256);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.GrainFarm);
        const millId = sim.placeBuilding(BuildingType.Mill);

        sim.runUntil(() => sim.getOutput(millId, EMaterialType.FLOUR) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(millId, EMaterialType.FLOUR)).toBeGreaterThanOrEqual(1);
    });

    // NOTE: Mead (HONEY+WATER), Tequila (AGAVE→TEQUILA), and SunflowerOil (SUNFLOWER→OIL)
    // chains are not tested here — they involve transformer buildings with additional input
    // requirements (e.g. MeadMakerHut needs WATER) that belong in production-chains.spec.ts.
});

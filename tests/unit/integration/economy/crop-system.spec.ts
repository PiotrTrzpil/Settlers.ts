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
import {
    createSimulation,
    cleanupSimulation,
    type Simulation,
    scanFreeTiles,
    printBuildingDiagnosticMap,
} from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';
import { MapObjectType } from '@/game/types/map-object-types';

// ── Helpers ──────────────────────────────────────────────────────

function getWorkAreaCenter(sim: Simulation, buildingId: number) {
    const b = sim.state.getEntity(buildingId)!;
    return sim.services.workAreaStore.getAbsoluteCenter(
        buildingId,
        b.x,
        b.y,
        b.subType as BuildingType,
        sim.state.playerRaces.get(b.player)!
    );
}

function collectPlantedPositions(sim: Simulation) {
    const positions: { x: number; y: number }[] = [];
    sim.eventBus.on('crop:planted', e => positions.push({ x: e.x, y: e.y }));
    return positions;
}

/** Chebyshev (chessboard) distance */
function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

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

    // ── Grain (Viking) — regression: 2 consecutive GO_TO_TARGET nodes ──

    it('grain farm (Viking): farmer plants grain despite multi-step walk choreography', () => {
        sim = createSimulation({ ...SIM_256, race: Race.Viking });

        let planted = 0;
        let failCount = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('settler:taskFailed', e => {
            if (e.jobId === 'JOB_FARMERGRAIN_PLANT') failCount++;
        });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        sim.runUntil(() => planted >= 1, { maxTicks: 3000 * 30 });
        expect(planted).toBeGreaterThanOrEqual(1);

        // The Viking choreography has 2 GO_TO_TARGET nodes — the farmer should NOT
        // get stuck in a fail/restart loop at the second GO_TO_TARGET.
        expect(
            failCount,
            `Farmer stuck in fail loop: ${failCount} task failures on JOB_FARMERGRAIN_PLANT. ` +
                'Likely targetPos cleared between consecutive GO_TO_TARGET nodes.'
        ).toBe(0);

        expect(sim.getOutput(farmId, EMaterialType.GRAIN)).toBeGreaterThanOrEqual(0);
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

    // ── Planting from work area center ──────────────────────────

    it('grain farm: crops are planted outward from the work area center', () => {
        sim = createSimulation(SIM_256);

        const planted = collectPlantedPositions(sim);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        sim.runUntil(() => planted.length >= 6, { maxTicks: 3000 * 30 });
        expect(planted.length).toBeGreaterThanOrEqual(6);

        const center = getWorkAreaCenter(sim, farmId);

        // First crop should be at or adjacent to the work area center
        expect(chebyshev(planted[0]!, center)).toBeLessThanOrEqual(1);

        // All early crops should cluster tightly around center, not off to one side
        for (let i = 0; i < 3; i++) {
            expect(chebyshev(planted[i]!, center)).toBeLessThanOrEqual(2);
        }
    });

    it('grain farm: first crop is planted at closest valid tile to work area center', () => {
        sim = createSimulation(SIM_256);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        const farm = sim.state.getEntity(farmId)!;
        const race = sim.state.playerRaces.get(farm.player)!;
        const center = getWorkAreaCenter(sim, farmId);

        // Scan free tiles BEFORE planting starts
        const candidates = scanFreeTiles(sim.state, center, 8, 20);
        const top5 = candidates.slice(0, 5);
        printBuildingDiagnosticMap(farm, BuildingType.GrainFarm, race, center, top5);

        // Run and verify the farmer picks the closest
        const planted = collectPlantedPositions(sim);
        sim.runUntil(() => planted.length >= 5, { maxTicks: 3000 * 30 });

        const minFreeDistSq = top5[0]!.distSq;
        const cropDx = planted[0]!.x - center.x;
        const cropDy = planted[0]!.y - center.y;
        const cropDistSq = cropDx * cropDx + cropDy * cropDy;

        expect(
            cropDistSq,
            `First crop at (${planted[0]!.x},${planted[0]!.y}) should be at closest ` +
                `free tile to center (${center.x},${center.y}). ` +
                `Got distSq=${cropDistSq}, expected=${minFreeDistSq}`
        ).toBe(minFreeDistSq);
    });

    it('grain farm: early crops fill outward from work area center', () => {
        sim = createSimulation(SIM_256);

        const planted = collectPlantedPositions(sim);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        sim.runUntil(() => planted.length >= 8, { maxTicks: 3000 * 30 });
        expect(planted.length).toBeGreaterThanOrEqual(8);

        const center = getWorkAreaCenter(sim, farmId);

        // Each successive crop should be at equal or greater distance from center
        // (the search always picks closest valid tile)
        const distances = planted.map(p => {
            const dx = p.x - center.x;
            const dy = p.y - center.y;
            return dx * dx + dy * dy;
        });

        for (let i = 1; i < distances.length; i++) {
            expect(
                distances[i]!,
                `Crop ${i} (distSq=${distances[i]}) should not be closer than ` +
                    `crop ${i - 1} (distSq=${distances[i - 1]})`
            ).toBeGreaterThanOrEqual(distances[i - 1]!);
        }
    });

    it('grain farm: farmer ignores mature crops outside the work area', () => {
        sim = createSimulation(SIM_256);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        const center = getWorkAreaCenter(sim, farmId);
        const farm = sim.state.getEntity(farmId)!;
        const race = sim.state.playerRaces.get(farm.player)!;
        const radius = sim.services.workAreaStore.getRadius(farm.subType as BuildingType, race);

        // Spawn a crop well outside the work area — entity:created handler
        // registers it as Mature (harvestable) since it wasn't planted by a farmer
        const farX = center.x + radius * 2;
        const farY = center.y;
        sim.execute({ type: 'spawn_map_object', objectType: MapObjectType.Grain, x: farX, y: farY });

        // Track which crops get harvested and their positions
        const harvestedPositions: { x: number; y: number }[] = [];
        sim.eventBus.on('crop:harvested', e => {
            const entity = sim.state.getEntity(e.entityId);
            if (entity) harvestedPositions.push({ x: entity.x, y: entity.y });
        });

        // Let the farmer plant some crops and start harvesting
        sim.runUntil(() => harvestedPositions.length >= 1, { maxTicks: 5000 * 30 });

        // The far-away crop should NOT have been harvested
        for (const pos of harvestedPositions) {
            const dx = pos.x - center.x;
            const dy = pos.y - center.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            expect(
                dist,
                `crop harvested at (${pos.x}, ${pos.y}) is outside work area (dist=${dist.toFixed(1)}, radius=${radius})`
            ).toBeLessThanOrEqual(radius + 1);
        }
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

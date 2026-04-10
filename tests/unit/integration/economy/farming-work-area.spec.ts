/**
 * Integration tests for farming work area radius enforcement.
 *
 * Verifies that farmers plant AND harvest strictly within the building's
 * work area radius (from XML buildingInfo.workingAreaRadius), centered on
 * the work area center (workingPos offset from building anchor).
 *
 * Covers all crop types across all races:
 *   Roman:  GrainFarm (radius 7), Vinyard (radius 5)
 *   Viking: GrainFarm (radius 7), BeekeeperHut (radius 7)
 *   Mayan:  GrainFarm (radius 7), AgaveFarmerHut (radius 10)
 *   Trojan: GrainFarm (radius 7), SunflowerFarmerHut (radius 13)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';
import { MapObjectType } from '@/game/types/map-object-types';
import type { Tile } from '@/game/core/coordinates';
import { hexDistance } from '@/game/systems/hex-directions';

// ── Helpers ──────────────────────────────────────────────────────

function getWorkAreaCenter(sim: Simulation, buildingId: number): Tile {
    const b = sim.state.getEntityOrThrow(buildingId, 'test:getWorkAreaCenter');
    return sim.services.workAreaStore.getAbsoluteCenter(buildingId, b.x, b.y, b.subType as BuildingType, b.race);
}

function getWorkAreaRadius(sim: Simulation, buildingId: number): number {
    const b = sim.state.getEntityOrThrow(buildingId, 'test:getWorkAreaRadius');
    return sim.services.workAreaStore.getRadius(b.subType as BuildingType, b.race);
}

function collectPlantedPositions(sim: Simulation): Tile[] {
    const positions: Tile[] = [];
    sim.eventBus.on('crop:planted', e => positions.push({ x: e.x, y: e.y }));
    return positions;
}

function collectHarvestedPositions(sim: Simulation): Tile[] {
    const positions: Tile[] = [];
    sim.eventBus.on('crop:harvested', e => {
        const entity = sim.state.getEntity(e.entityId);
        if (entity) positions.push({ x: entity.x, y: entity.y });
    });
    return positions;
}

/** Euclidean distance from a point to the work area center. */
function distToCenter(pos: Tile, center: Tile): number {
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Assert all positions are within the work area radius.
 * Allows +1 tolerance for hex grid rounding.
 */
function assertWithinWorkArea(positions: Tile[], center: Tile, radius: number, label: string): void {
    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i]!;
        const dist = distToCenter(pos, center);
        expect(
            dist,
            `${label}[${i}] at (${pos.x},${pos.y}) is outside work area ` +
                `(dist=${dist.toFixed(1)}, radius=${radius}, center=(${center.x},${center.y}))`
        ).toBeLessThanOrEqual(radius + 1);
    }
}

installRealGameData();

const SIM_256 = { mapWidth: 256, mapHeight: 256 } as const;

// ── Planting radius enforcement ─────────────────────────────────

describe('Farming work area — planting radius', { timeout: 15_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    const farmConfigs = [
        { name: 'GrainFarm (Roman)', building: BuildingType.GrainFarm, race: Race.Roman },
        { name: 'Vinyard (Roman)', building: BuildingType.Vinyard, race: Race.Roman },
        { name: 'GrainFarm (Viking)', building: BuildingType.GrainFarm, race: Race.Viking },
        { name: 'BeekeeperHut (Viking)', building: BuildingType.BeekeeperHut, race: Race.Viking },
        { name: 'GrainFarm (Mayan)', building: BuildingType.GrainFarm, race: Race.Mayan },
        { name: 'AgaveFarmerHut (Mayan)', building: BuildingType.AgaveFarmerHut, race: Race.Mayan },
        { name: 'SunflowerFarmerHut (Trojan)', building: BuildingType.SunflowerFarmerHut, race: Race.Trojan },
    ] as const;

    for (const { name, building, race } of farmConfigs) {
        it(`${name}: all planted crops are within work area radius`, () => {
            sim = createSimulation({ ...SIM_256, race });

            const planted = collectPlantedPositions(sim);

            sim.placeBuilding(BuildingType.ResidenceSmall);
            const farmId = sim.placeBuilding(building);

            const center = getWorkAreaCenter(sim, farmId);
            const radius = getWorkAreaRadius(sim, farmId);
            expect(radius, `${name} should have a work area radius > 0`).toBeGreaterThan(0);

            sim.runUntil(() => planted.length >= 5, { maxTicks: 3000 * 30 });
            expect(planted.length).toBeGreaterThanOrEqual(5);

            assertWithinWorkArea(planted, center, radius, `${name} planted crop`);
        });
    }
});

// ── Harvest radius enforcement ──────────────────────────────────

describe('Farming work area — harvest radius', { timeout: 15_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('farmer ignores mature crops outside the work area', () => {
        sim = createSimulation(SIM_256);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        const center = getWorkAreaCenter(sim, farmId);
        const radius = getWorkAreaRadius(sim, farmId);

        // Spawn a mature crop FAR outside the work area
        const farX = center.x + radius * 3;
        const farY = center.y;
        sim.execute({ type: 'spawn_map_object', objectType: MapObjectType.Grain, x: farX, y: farY });

        const harvested = collectHarvestedPositions(sim);

        // Wait for at least one harvest cycle (farmer must plant, wait for growth, then harvest)
        sim.runUntil(() => harvested.length >= 1, { maxTicks: 5000 * 30 });
        expect(harvested.length).toBeGreaterThanOrEqual(1);

        assertWithinWorkArea(harvested, center, radius, 'harvested crop');

        // Verify the far crop was NOT harvested
        const farCropHarvested = harvested.some(p => hexDistance(p.x, p.y, farX, farY) <= 1);
        expect(farCropHarvested, `Crop at (${farX},${farY}) outside work area should NOT have been harvested`).toBe(
            false
        );
    });

    it('all harvested crops are within work area radius (full lifecycle)', () => {
        sim = createSimulation(SIM_256);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        const center = getWorkAreaCenter(sim, farmId);
        const radius = getWorkAreaRadius(sim, farmId);
        const harvested = collectHarvestedPositions(sim);

        sim.runUntil(() => harvested.length >= 3, { maxTicks: 5000 * 30 });
        expect(harvested.length).toBeGreaterThanOrEqual(3);

        assertWithinWorkArea(harvested, center, radius, 'harvested crop');
    });
});

// ── Search center enforcement ───────────────────────────────────

describe('Farming work area — search center', { timeout: 15_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('farmer plants from work area center, not building door', () => {
        sim = createSimulation(SIM_256);

        const planted = collectPlantedPositions(sim);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const farmId = sim.placeBuilding(BuildingType.GrainFarm);

        const center = getWorkAreaCenter(sim, farmId);
        const farm = sim.state.getEntityOrThrow(farmId, 'test');

        // Work area center should be offset from building position
        const centerDist = hexDistance(center.x, center.y, farm.x, farm.y);
        expect(centerDist, 'work area center should be offset from building').toBeGreaterThan(0);

        sim.runUntil(() => planted.length >= 3, { maxTicks: 3000 * 30 });

        // Early crops cluster near work area center, not near building anchor
        const avgDistToCenter = planted.slice(0, 3).reduce((sum, p) => sum + distToCenter(p, center), 0) / 3;
        const avgDistToBuilding = planted.slice(0, 3).reduce((sum, p) => sum + distToCenter(p, farm), 0) / 3;

        expect(
            avgDistToCenter,
            `Early crops should be closer to work area center than to building. ` +
                `Avg to center: ${avgDistToCenter.toFixed(1)}, avg to building: ${avgDistToBuilding.toFixed(1)}`
        ).toBeLessThan(avgDistToBuilding);
    });
});

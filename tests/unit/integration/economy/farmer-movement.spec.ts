/**
 * Integration tests for farmer movement after farm construction completes.
 *
 * Reproduces a bug where the farmer spawns at the building door after
 * construction completes, but never walks to the work area — instead
 * standing at the door, rotating, and playing the seeding animation
 * in place. Crops get planted at/near the door instead of near the
 * work area center.
 *
 * Moving the work area at runtime "unlocks" the farmer, suggesting
 * the initial planting position search returns spots too close to
 * the door (or the farmer's position after exiting the building).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { hexDistance } from '@/game/systems/hex-directions';
import { UnitType, Tile } from '@/game/entity';

function grainFarmSite() {
    const s = createScenario.constructionSite(
        BuildingType.GrainFarm,
        [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
            [EMaterialType.LOG, 8],
        ],
        { mapWidth: 256, mapHeight: 256 }
    );
    s.placeGoods(EMaterialType.SCYTHE, 1);
    s.placeGoods(EMaterialType.SHOVEL, 4);
    s.placeGoods(EMaterialType.HAMMER, 4);
    // Extra materials — GrainFarm may need more than 8 of each with real data
    s.injectOutput(s.storageId, EMaterialType.BOARD, 8);
    s.injectOutput(s.storageId, EMaterialType.STONE, 8);
    return s;
}

installRealGameData();

describe('Farmer movement after construction', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('farmer walks to work area after farm construction completes (not stuck at door)', () => {
        const s = grainFarmSite();
        sim = s;

        // Wait for construction to complete — farmer will be spawned at the door
        sim.waitForConstructionComplete(s.siteId, 80_000);

        const farm = sim.state.getEntity(s.siteId)!;
        const door = getBuildingDoorPos(farm, farm.race, BuildingType.GrainFarm);
        const workCenter = sim.services.workAreaStore.getAbsoluteCenter(
            s.siteId,
            farm.x,
            farm.y,
            BuildingType.GrainFarm,
            farm.race
        );

        // Sanity: door and work area center should be different positions
        const doorToCenter = hexDistance(door.x, door.y, workCenter.x, workCenter.y);
        expect(doorToCenter, 'door and work area center should be apart').toBeGreaterThan(1);

        // Track planted positions
        const plantedPositions: Tile[] = [];
        sim.eventBus.on('crop:planted', e => plantedPositions.push({ x: e.x, y: e.y }));

        // Wait for first crop to be planted
        sim.runUntil(() => plantedPositions.length >= 1, {
            maxTicks: 3000 * 30,
            label: 'first crop planted after construction',
        });
        expect(plantedPositions.length).toBeGreaterThanOrEqual(1);

        // The first crop should be planted near the work area center, NOT near the door
        const firstCrop = plantedPositions[0]!;
        const cropToDoor = hexDistance(firstCrop.x, firstCrop.y, door.x, door.y);
        const cropToCenter = hexDistance(firstCrop.x, firstCrop.y, workCenter.x, workCenter.y);

        expect(
            cropToCenter,
            `First crop at (${firstCrop.x},${firstCrop.y}) should be near work area center ` +
                `(${workCenter.x},${workCenter.y}), not door (${door.x},${door.y}). ` +
                `Distance to center: ${cropToCenter}, distance to door: ${cropToDoor}`
        ).toBeLessThanOrEqual(2);
    });

    it('farmer not stuck at door when carriers crowd the door area', () => {
        const s = grainFarmSite();
        sim = s;

        // Let construction complete first
        sim.waitForConstructionComplete(s.siteId, 80_000);

        const farm = sim.state.getEntity(s.siteId)!;
        const door = getBuildingDoorPos(farm, farm.race, BuildingType.GrainFarm);

        // NOW spawn many carriers near the farm door to simulate a busy economy
        // The farmer is inside the building at this point — carriers crowd the exit
        let spawned = 0;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue;
                try {
                    sim.spawnUnit({ x: door.x + dx, y: door.y + dy }, UnitType.Carrier);
                    spawned++;
                } catch {
                    // tile occupied — skip
                }
            }
        }
        // Ensure we actually crowded the area
        expect(spawned, 'should spawn carriers near door').toBeGreaterThanOrEqual(5);

        // Enable verbose choreo to see what the farmer does
        sim.services.settlerTaskSystem.verbose = true;

        const workCenter = sim.services.workAreaStore.getAbsoluteCenter(
            s.siteId,
            farm.x,
            farm.y,
            BuildingType.GrainFarm,
            farm.race
        );

        const plantedPositions: Tile[] = [];
        sim.eventBus.on('crop:planted', e => plantedPositions.push({ x: e.x, y: e.y }));

        sim.runUntil(() => plantedPositions.length >= 1, {
            maxTicks: 3000 * 30,
            label: 'first crop planted (crowded door)',
        });
        expect(plantedPositions.length).toBeGreaterThanOrEqual(1);

        const firstCrop = plantedPositions[0]!;
        const cropToDoor = hexDistance(firstCrop.x, firstCrop.y, door.x, door.y);
        const cropToCenter = hexDistance(firstCrop.x, firstCrop.y, workCenter.x, workCenter.y);

        expect(
            cropToCenter,
            `First crop at (${firstCrop.x},${firstCrop.y}) should be near work area center ` +
                `(${workCenter.x},${workCenter.y}), not door (${door.x},${door.y}). ` +
                `Distance to center: ${cropToCenter}, distance to door: ${cropToDoor}`
        ).toBeLessThanOrEqual(2);

        expect(cropToDoor, `First crop planted at door — farmer didn't walk to work area.`).toBeGreaterThan(1);
    });

    it('farmer does not repeatedly plant at door after construction', () => {
        const s = grainFarmSite();
        sim = s;

        sim.waitForConstructionComplete(s.siteId, 80_000);

        const farm = sim.state.getEntity(s.siteId)!;
        const door = getBuildingDoorPos(farm, farm.race, BuildingType.GrainFarm);

        const plantedPositions: Tile[] = [];
        sim.eventBus.on('crop:planted', e => plantedPositions.push({ x: e.x, y: e.y }));

        // Wait for several crops
        sim.runUntil(() => plantedPositions.length >= 4, {
            maxTicks: 3000 * 30,
            label: '4 crops planted after construction',
        });
        expect(plantedPositions.length).toBeGreaterThanOrEqual(4);

        // No crop should be planted at or adjacent to the door
        const cropsAtDoor = plantedPositions.filter(p => hexDistance(p.x, p.y, door.x, door.y) <= 1);
        expect(
            cropsAtDoor.length,
            `${cropsAtDoor.length} of ${plantedPositions.length} crops planted at/adjacent to ` +
                `door (${door.x},${door.y}). Farmer should walk to work area before planting.`
        ).toBe(0);
    });

    it('constructed farm produces grain (full lifecycle)', () => {
        const s = grainFarmSite();
        sim = s;

        sim.waitForConstructionComplete(s.siteId, 80_000);

        sim.runUntil(() => sim.getOutput(s.siteId, EMaterialType.GRAIN) >= 1, {
            maxTicks: 5000 * 30,
            label: 'grain produced after construction',
        });
        expect(sim.getOutput(s.siteId, EMaterialType.GRAIN)).toBeGreaterThanOrEqual(1);
    });
});

/**
 * Tests for building construction: terrain leveling and construction phases.
 *
 * Note: screenToTile height refinement and heightToWorld tests have been
 * consolidated into coordinates.spec.ts where they logically belong.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BuildingType, getBuildingFootprint } from '@/game/entity';
import { Race } from '@/game/core/race';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';
import type { TerrainBuildingParams } from '@/game/features/building-construction/terrain';
import { createTestMap, TERRAIN } from '../helpers/test-map';
import { installTestGameData, resetTestGameData } from '../helpers/test-game-data';

function makeTerrainParams(
    tileX: number,
    tileY: number,
    buildingType: BuildingType,
    race = Race.Roman
): TerrainBuildingParams {
    return { buildingType, race, tileX, tileY };
}

// ---------------------------------------------------------------------------
// Terrain Leveling
// ---------------------------------------------------------------------------

describe('Terrain Leveling', () => {
    beforeEach(() => installTestGameData());
    afterEach(() => resetTestGameData());

    it('should capture footprint + neighbor tiles with correct heights and no duplicates', () => {
        const map = createTestMap();
        map.groundHeight[map.mapSize.toIndex(10, 10)] = 100;
        map.groundHeight[map.mapSize.toIndex(11, 10)] = 120;

        const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
        const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

        // 2x2 footprint
        const footprintTiles = captured.tiles.filter(t => t.isFootprint);
        expect(footprintTiles).toHaveLength(4);

        // Neighbors captured
        const neighborTiles = captured.tiles.filter(t => !t.isFootprint);
        expect(neighborTiles.length).toBeGreaterThanOrEqual(8);

        // No duplicates
        const coordKeys = captured.tiles.map(t => `${t.x},${t.y}`);
        expect(new Set(coordKeys).size).toBe(coordKeys.length);

        // Original values preserved
        const tile1010 = captured.tiles.find(t => t.x === 10 && t.y === 10)!;
        expect(tile1010.originalGroundHeight).toBe(100);
        const tile1110 = captured.tiles.find(t => t.x === 11 && t.y === 10)!;
        expect(tile1110.originalGroundHeight).toBe(120);
    });

    it('should interpolate heights toward target and level fully at progress 1.0', () => {
        const map = createTestMap();
        map.groundHeight[map.mapSize.toIndex(10, 10)] = 200;
        map.groundHeight[map.mapSize.toIndex(11, 10)] = 0;
        map.groundHeight[map.mapSize.toIndex(10, 11)] = 0;
        map.groundHeight[map.mapSize.toIndex(11, 11)] = 0;

        const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
        const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);
        const target = originalTerrain.targetHeight;

        // Progress 0 - no change
        expect(applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 0, originalTerrain)).toBe(
            false
        );
        expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);

        // Progress 0.5 - interpolated
        applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 0.5, originalTerrain);
        const h1010 = map.groundHeight[map.mapSize.toIndex(10, 10)];
        expect(h1010).toBe(Math.round(200 + (target - 200) * 0.5));

        // Progress 1.0 - fully leveled with construction ground type
        applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 1.0, originalTerrain);
        for (const tile of getBuildingFootprint(10, 10, BuildingType.WoodcutterHut, Race.Roman)) {
            expect(map.groundHeight[map.mapSize.toIndex(tile.x, tile.y)]).toBe(target);
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Neighbors should NOT have construction ground type
        expect(map.groundType[map.mapSize.toIndex(9, 10)]).toBe(TERRAIN.GRASS);
    });

    it('should restore original terrain after leveling', () => {
        const map = createTestMap();
        map.groundHeight[map.mapSize.toIndex(10, 10)] = 100;
        map.groundHeight[map.mapSize.toIndex(11, 10)] = 120;

        const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
        const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

        applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 1.0, originalTerrain);
        expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

        const modified = restoreOriginalTerrain(originalTerrain, map.groundType, map.groundHeight, map.mapSize);
        expect(modified).toBe(true);
        expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
        expect(map.groundHeight[map.mapSize.toIndex(10, 10)]).toBe(100);
        expect(map.groundHeight[map.mapSize.toIndex(11, 10)]).toBe(120);
    });
});

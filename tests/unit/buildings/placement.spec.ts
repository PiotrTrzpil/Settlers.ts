import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    canPlaceBuilding,
    canPlaceBuildingFootprint,
    computeSlopeDifficulty,
    PlacementStatus,
} from '@/game/features/placement';
import { BuildingType } from '@/game/entity';
import { Race } from '@/game/race';
import { createTestMap, TERRAIN, setTerrainAt, setHeightAt, type TestMap } from '../helpers/test-map';
import { installTestGameData, resetTestGameData } from '../helpers/test-game-data';

describe('canPlaceBuilding – terrain and occupancy', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should allow placement on flat grass and reject water or occupied tiles', () => {
        expect(canPlaceBuilding(map.terrain, map.occupancy, 10, 10)).toBe(true);

        setTerrainAt(map, 10, 10, TERRAIN.WATER);
        expect(canPlaceBuilding(map.terrain, map.occupancy, 10, 10)).toBe(false);

        setTerrainAt(map, 10, 10, TERRAIN.GRASS);
        map.occupancy.set('10,10', 1);
        expect(canPlaceBuilding(map.terrain, map.occupancy, 10, 10)).toBe(false);
    });

    it('should allow placement regardless of neighbor height (slope handled by footprint check)', () => {
        // canPlaceBuilding no longer checks slope - that's done by footprint validation
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 50); // large diff - but single-tile check doesn't look at neighbors
        expect(canPlaceBuilding(map.terrain, map.occupancy, 10, 10)).toBe(true);
    });
});

describe('canPlaceBuildingFootprint – per-tile gradient slope check', () => {
    let map: TestMap;

    afterEach(() => resetTestGameData());
    beforeEach(() => {
        installTestGameData();
        map = createTestMap();
    });

    it('should allow building when per-tile gradients are within limit, even with large total range', () => {
        // Total range is 8 (would fail old min/max check) but each tile differs by at most 4 from neighbors
        setHeightAt(map, 10, 10, 0);
        setHeightAt(map, 11, 10, 4);
        setHeightAt(map, 12, 10, 8);
        setHeightAt(map, 10, 11, 4);
        setHeightAt(map, 11, 11, 8);
        setHeightAt(map, 12, 11, 8);
        setHeightAt(map, 10, 12, 8);
        setHeightAt(map, 11, 12, 8);
        setHeightAt(map, 12, 12, 8);
        expect(
            canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, BuildingType.StorageArea, Race.Roman)
        ).toBe(true);
    });

    it('should reject building when adjacent tiles in footprint have steep slope', () => {
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 20); // diff = 10 from (10,10), exceeds MAX_SLOPE_DIFF of 8
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 11, 11, 10);
        expect(
            canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, BuildingType.WoodcutterHut, Race.Roman)
        ).toBe(false);
    });
});

describe('mine terrain restrictions', () => {
    let map: TestMap;

    afterEach(() => resetTestGameData());
    beforeEach(() => {
        installTestGameData();
        map = createTestMap();
    });

    it('should require rock terrain for mines and reject non-mines on rock', () => {
        // Mine on grass: rejected
        expect(canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, BuildingType.CoalMine, Race.Roman)).toBe(
            false
        );

        // Set 2x2 to rock
        setTerrainAt(map, 10, 10, TERRAIN.ROCK);
        setTerrainAt(map, 11, 10, TERRAIN.ROCK);
        setTerrainAt(map, 10, 11, TERRAIN.ROCK);
        setTerrainAt(map, 11, 11, TERRAIN.ROCK);

        // Mine on rock: allowed
        expect(canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, BuildingType.CoalMine, Race.Roman)).toBe(
            true
        );

        // Non-mine on rock: rejected
        expect(
            canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, BuildingType.WoodcutterHut, Race.Roman)
        ).toBe(false);
    });

    it('should reject mine when only some tiles are rock', () => {
        setTerrainAt(map, 10, 10, TERRAIN.ROCK);
        // (11,10) remains grass
        setTerrainAt(map, 10, 11, TERRAIN.ROCK);
        setTerrainAt(map, 11, 11, TERRAIN.ROCK);
        expect(canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, BuildingType.CoalMine, Race.Roman)).toBe(
            false
        );
    });

    it('should apply rock restriction to all mine types', () => {
        setTerrainAt(map, 10, 10, TERRAIN.ROCK);
        setTerrainAt(map, 11, 10, TERRAIN.ROCK);
        setTerrainAt(map, 10, 11, TERRAIN.ROCK);
        setTerrainAt(map, 11, 11, TERRAIN.ROCK);

        for (const mineType of [
            BuildingType.CoalMine,
            BuildingType.IronMine,
            BuildingType.GoldMine,
            BuildingType.StoneMine,
            BuildingType.SulfurMine,
        ]) {
            expect(canPlaceBuildingFootprint(map.terrain, map.occupancy, 10, 10, mineType, Race.Roman)).toBe(true);
        }
    });
});

describe('computeSlopeDifficulty', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should classify slope difficulty by per-tile height differences', () => {
        const tiles2x2 = [
            { x: 10, y: 10 },
            { x: 11, y: 10 },
            { x: 10, y: 11 },
            { x: 11, y: 11 },
        ];

        // Flat terrain -> Easy
        expect(computeSlopeDifficulty(tiles2x2, map.groundHeight, map.mapSize)).toBe(PlacementStatus.Easy);

        // Gentle slope (diff 1) -> Medium
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 11);
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 11, 11, 11);
        expect(computeSlopeDifficulty(tiles2x2, map.groundHeight, map.mapSize)).toBe(PlacementStatus.Medium);

        // Moderate slope (diff 8) -> Difficult
        setHeightAt(map, 11, 10, 18);
        setHeightAt(map, 11, 11, 18);
        expect(computeSlopeDifficulty(tiles2x2, map.groundHeight, map.mapSize)).toBe(PlacementStatus.Difficult);

        // Steep slope (diff 10 > MAX_SLOPE_DIFF of 8) -> TooSteep
        setHeightAt(map, 11, 10, 20);
        setHeightAt(map, 11, 11, 10);
        expect(computeSlopeDifficulty(tiles2x2, map.groundHeight, map.mapSize)).toBe(PlacementStatus.TooSteep);
    });
});

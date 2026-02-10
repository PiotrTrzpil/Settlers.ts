import { describe, it, expect, beforeEach } from 'vitest';
import { canPlaceBuilding, canPlaceBuildingFootprint, computeSlopeDifficulty, PlacementStatus } from '@/game/features/placement';
import { BuildingType } from '@/game/entity';
import { createTestMap, TERRAIN, setTerrainAt, setHeightAt, type TestMap } from './helpers/test-map';

// Note: isPassable and isBuildable terrain-type tests are covered by the
// game-session flow test which validates all terrain types against both functions.
// This file focuses on canPlaceBuilding edge cases only.

describe('canPlaceBuilding – edge cases', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should allow placement on flat grass', () => {
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(true);
    });

    it('should reject placement on water', () => {
        setTerrainAt(map, 10, 10, TERRAIN.WATER);
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(false);
    });

    it('should reject placement on occupied tile', () => {
        map.occupancy.set('10,10', 1);
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(false);
    });

    // Note: canPlaceBuilding no longer checks slope - that's handled by the footprint
    // validator (validateBuildingPlacement / canPlaceBuildingFootprint) since terrain
    // leveling during construction smooths out height differences.

    it('should allow placement on gentle slope', () => {
        setHeightAt(map, 10, 10, 5);
        setHeightAt(map, 11, 10, 4);
        setHeightAt(map, 9, 10, 4);
        setHeightAt(map, 10, 11, 4);
        setHeightAt(map, 10, 9, 4);
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(true);
    });

    it('should allow placement regardless of neighbor height (slope handled by footprint check)', () => {
        // canPlaceBuilding no longer checks slope - that's done by footprint validation
        // Terrain leveling during construction handles height differences
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 50); // large diff - but we don't check neighbors anymore
        setHeightAt(map, 9, 10, 10);
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 10, 9, 10);
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(true);
    });
});

describe('canPlaceBuildingFootprint – per-tile gradient slope check', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should allow 2x2 building on flat terrain', () => {
        expect(canPlaceBuildingFootprint(
            map.groundType, map.groundHeight, map.mapSize, map.occupancy,
            10, 10, BuildingType.WoodcutterHut
        )).toBe(true);
    });

    it('should allow 2x2 building with gradual slope across footprint', () => {
        // Gradual slope: each tile differs by 2 from neighbors (within MAX_SLOPE_DIFF of 4)
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 12);
        setHeightAt(map, 10, 11, 12);
        setHeightAt(map, 11, 11, 14);
        expect(canPlaceBuildingFootprint(
            map.groundType, map.groundHeight, map.mapSize, map.occupancy,
            10, 10, BuildingType.WoodcutterHut
        )).toBe(true);
    });

    it('should allow 3x3 building with large total height range but per-tile gradients within limit', () => {
        // Total range is 8 (would fail old min/max check) but each tile differs by at most 4 from neighbors
        setHeightAt(map, 10, 10, 0);  setHeightAt(map, 11, 10, 4);  setHeightAt(map, 12, 10, 8);
        setHeightAt(map, 10, 11, 4);  setHeightAt(map, 11, 11, 8);  setHeightAt(map, 12, 11, 8);
        setHeightAt(map, 10, 12, 8);  setHeightAt(map, 11, 12, 8);  setHeightAt(map, 12, 12, 8);
        expect(canPlaceBuildingFootprint(
            map.groundType, map.groundHeight, map.mapSize, map.occupancy,
            10, 10, BuildingType.StorageArea
        )).toBe(true);
    });

    it('should reject building when adjacent tiles in footprint have steep slope', () => {
        // Two adjacent tiles differ by 10 (exceeds MAX_SLOPE_DIFF of 8)
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 20); // diff = 10 from (10,10)
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 11, 11, 10);
        expect(canPlaceBuildingFootprint(
            map.groundType, map.groundHeight, map.mapSize, map.occupancy,
            10, 10, BuildingType.WoodcutterHut
        )).toBe(false);
    });
});

describe('computeSlopeDifficulty', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should return Easy for flat terrain', () => {
        const tiles = [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }];
        expect(computeSlopeDifficulty(tiles, map.groundHeight, map.mapSize)).toBe(PlacementStatus.Easy);
    });

    it('should return Medium for gentle slope (diff 1-2)', () => {
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 11);
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 11, 11, 11);
        const tiles = [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }];
        expect(computeSlopeDifficulty(tiles, map.groundHeight, map.mapSize)).toBe(PlacementStatus.Medium);
    });

    it('should return Difficult for moderate slope (diff 3-8)', () => {
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 18); // diff = 8
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 11, 11, 18);
        const tiles = [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }];
        expect(computeSlopeDifficulty(tiles, map.groundHeight, map.mapSize)).toBe(PlacementStatus.Difficult);
    });

    it('should return TooSteep when adjacent tiles differ by more than MAX_SLOPE_DIFF (8)', () => {
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 20); // diff = 10 > 8
        setHeightAt(map, 10, 11, 10);
        setHeightAt(map, 11, 11, 10);
        const tiles = [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }];
        expect(computeSlopeDifficulty(tiles, map.groundHeight, map.mapSize)).toBe(PlacementStatus.TooSteep);
    });
});

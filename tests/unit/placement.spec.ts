import { describe, it, expect, beforeEach } from 'vitest';
import { canPlaceBuilding } from '@/game/systems/placement';
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

    it('should reject placement on steep slope', () => {
        setHeightAt(map, 10, 10, 10);
        setHeightAt(map, 11, 10, 0);
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(false);
    });

    it('should allow placement on gentle slope', () => {
        setHeightAt(map, 10, 10, 5);
        setHeightAt(map, 11, 10, 4);
        setHeightAt(map, 9, 10, 4);
        setHeightAt(map, 10, 11, 4);
        setHeightAt(map, 10, 9, 4);
        expect(canPlaceBuilding(map.groundType, map.groundHeight, map.mapSize, map.occupancy, 10, 10)).toBe(true);
    });
});

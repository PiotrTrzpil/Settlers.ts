import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, EntityType, BuildingType } from '@/game/entity';
import { TerritoryMap, NO_OWNER } from '@/game/buildings/territory';
import { createTestMap, type TestMap } from './helpers/test-map';

// Note: Basic territory claiming, multi-player ownership, overlap resolution,
// and rebuild-after-removal are covered by building-lifecycle flow tests.
// This file focuses on geometry/config edge cases only.

describe('TerritoryMap – edge cases', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    function makeBuilding(id: number, subType: BuildingType, x: number, y: number, player: number): Entity {
        return { id, type: EntityType.Building, subType, x, y, player };
    }

    it('should use circular territory shape', () => {
        const territory = new TerritoryMap(map.mapSize);
        territory.rebuild([makeBuilding(1, BuildingType.Tower, 20, 20, 0)]);

        expect(territory.getOwner(28, 28)).toBe(NO_OWNER); // ~11.3 away
        expect(territory.getOwner(27, 27)).toBe(0); // ~9.9 away
    });

    it('should use different radii for different building types', () => {
        const territory = new TerritoryMap(map.mapSize);
        territory.rebuild([makeBuilding(1, BuildingType.Lumberjack, 10, 10, 0)]);

        expect(territory.getOwner(13, 10)).toBe(0); // 3 tiles away, within radius 4
        expect(territory.getOwner(15, 10)).toBe(NO_OWNER); // 5 tiles away
    });

    it('should ignore non-building entities', () => {
        const territory = new TerritoryMap(map.mapSize);
        territory.rebuild([{ id: 1, type: EntityType.Unit, subType: 0, x: 20, y: 20, player: 0 }]);
        expect(territory.getOwner(20, 20)).toBe(NO_OWNER);
    });
});

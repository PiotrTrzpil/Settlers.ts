import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, EntityType, BuildingType } from '@/game/entity';
import { TerritoryMap, NO_OWNER } from '@/game/systems/territory';
import { MapSize } from '@/utilities/map-size';

describe('TerritoryMap', () => {
    let mapSize: MapSize;

    beforeEach(() => {
        mapSize = new MapSize(64, 64);
    });

    it('should start with all tiles unowned', () => {
        const territory = new TerritoryMap(mapSize);
        expect(territory.getOwner(10, 10)).toBe(NO_OWNER);
        expect(territory.getOwner(32, 32)).toBe(NO_OWNER);
    });

    it('should claim territory around a building', () => {
        const territory = new TerritoryMap(mapSize);
        const buildings: Entity[] = [{
            id: 1,
            type: EntityType.Building,
            subType: BuildingType.Guardhouse,
            x: 20,
            y: 20,
            player: 0
        }];

        territory.rebuild(buildings);

        // Guardhouse has radius 8: tile at (20,20) should be owned by player 0
        expect(territory.getOwner(20, 20)).toBe(0);
        // Tile at (25, 20) is 5 tiles away, within radius 8
        expect(territory.getOwner(25, 20)).toBe(0);
        // Tile at (30, 20) is 10 tiles away, outside radius 8
        expect(territory.getOwner(30, 20)).toBe(NO_OWNER);
    });

    it('should use circular territory shape', () => {
        const territory = new TerritoryMap(mapSize);
        const buildings: Entity[] = [{
            id: 1,
            type: EntityType.Building,
            subType: BuildingType.Guardhouse,
            x: 20,
            y: 20,
            player: 0
        }];

        territory.rebuild(buildings);

        // Diagonal at (26, 26) is ~8.5 away, outside radius 8
        expect(territory.getOwner(26, 26)).toBe(NO_OWNER);
        // Diagonal at (25, 25) is ~7.1 away, inside radius 8
        expect(territory.getOwner(25, 25)).toBe(0);
    });

    it('should use different radii for different building types', () => {
        const territory = new TerritoryMap(mapSize);
        const buildings: Entity[] = [{
            id: 1,
            type: EntityType.Building,
            subType: BuildingType.Lumberjack,
            x: 10,
            y: 10,
            player: 0
        }];

        territory.rebuild(buildings);

        // Woodcutter has radius 4
        expect(territory.getOwner(13, 10)).toBe(0); // 3 tiles away
        expect(territory.getOwner(15, 10)).toBe(NO_OWNER); // 5 tiles away
    });

    it('should handle multiple players', () => {
        const territory = new TerritoryMap(mapSize);
        const buildings: Entity[] = [
            {
                id: 1,
                type: EntityType.Building,
                subType: BuildingType.Guardhouse,
                x: 10,
                y: 10,
                player: 0
            },
            {
                id: 2,
                type: EntityType.Building,
                subType: BuildingType.Guardhouse,
                x: 40,
                y: 40,
                player: 1
            }
        ];

        territory.rebuild(buildings);

        expect(territory.getOwner(10, 10)).toBe(0);
        expect(territory.getOwner(40, 40)).toBe(1);
        expect(territory.isOwnedBy(10, 10, 0)).toBe(true);
        expect(territory.isOwnedBy(40, 40, 1)).toBe(true);
    });

    it('should resolve overlap by closest building', () => {
        const territory = new TerritoryMap(mapSize);
        // Two guardhouses 12 tiles apart (radius 8 each, so they overlap)
        const buildings: Entity[] = [
            {
                id: 1,
                type: EntityType.Building,
                subType: BuildingType.Guardhouse,
                x: 20,
                y: 20,
                player: 0
            },
            {
                id: 2,
                type: EntityType.Building,
                subType: BuildingType.Guardhouse,
                x: 32,
                y: 20,
                player: 1
            }
        ];

        territory.rebuild(buildings);

        // Midpoint at (26, 20) is 6 from player 0 and 6 from player 1
        // Since both are same distance, first building (player 0) has lower distance
        // Actually the second building at x=32 is exactly 6 away too, so first one wins
        expect(territory.getOwner(25, 20)).toBe(0); // 5 from P0, 7 from P1
        expect(territory.getOwner(27, 20)).toBe(1); // 7 from P0, 5 from P1
    });

    it('should clear territory on rebuild with no buildings', () => {
        const territory = new TerritoryMap(mapSize);
        const buildings: Entity[] = [{
            id: 1,
            type: EntityType.Building,
            subType: BuildingType.Guardhouse,
            x: 20,
            y: 20,
            player: 0
        }];

        territory.rebuild(buildings);
        expect(territory.getOwner(20, 20)).toBe(0);

        territory.rebuild([]);
        expect(territory.getOwner(20, 20)).toBe(NO_OWNER);
    });

    it('should ignore non-building entities', () => {
        const territory = new TerritoryMap(mapSize);
        const buildings: Entity[] = [{
            id: 1,
            type: EntityType.Unit,
            subType: 0,
            x: 20,
            y: 20,
            player: 0
        }];

        territory.rebuild(buildings);
        expect(territory.getOwner(20, 20)).toBe(NO_OWNER);
    });
});

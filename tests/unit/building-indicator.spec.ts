import { describe, it, expect, beforeEach } from 'vitest';
import {
    BuildingIndicatorRenderer,
    PlacementStatus,
    isBuildableStatus,
} from '@/game/renderer/building-indicator-renderer';
import { MapSize } from '@/utilities/map-size';
import { TerritoryMap } from '@/game/systems/territory';
import { BuildingType } from '@/game/entity';
import { TERRAIN } from './helpers/test-map';

describe('BuildingIndicatorRenderer', () => {
    let mapSize: MapSize;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;
    let renderer: BuildingIndicatorRenderer;

    beforeEach(() => {
        // BuildingIndicatorRenderer uses non-standard 10x10 map (produces warning but works)
        mapSize = new MapSize(10, 10);
        groundType = new Uint8Array(100);
        groundHeight = new Uint8Array(100);
        groundType.fill(TERRAIN.GRASS);
        groundHeight.fill(100);

        renderer = new BuildingIndicatorRenderer(mapSize, groundType, groundHeight);
        renderer.buildingType = BuildingType.Decoration;
    });

    describe('computePlacementStatus', () => {
        it('should return Easy for flat buildable terrain', () => {
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.Easy);
        });

        it('should return InvalidTerrain for water', () => {
            groundType[mapSize.toIndex(5, 5)] = TERRAIN.WATER;
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return InvalidTerrain for rock', () => {
            groundType[mapSize.toIndex(5, 5)] = TERRAIN.ROCK;
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return InvalidTerrain for beach', () => {
            groundType[mapSize.toIndex(5, 5)] = TERRAIN.BEACH;
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return InvalidTerrain for swamp', () => {
            groundType[mapSize.toIndex(5, 5)] = TERRAIN.SWAMP;
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return Medium for slight slope (difference 1) within footprint', () => {
            renderer.buildingType = BuildingType.Lumberjack;
            groundHeight[mapSize.toIndex(4, 4)] = 100;
            groundHeight[mapSize.toIndex(5, 4)] = 101;
            groundHeight[mapSize.toIndex(4, 5)] = 100;
            groundHeight[mapSize.toIndex(5, 5)] = 100;
            expect(renderer.computePlacementStatus(4, 4)).toBe(PlacementStatus.Medium);
        });

        it('should return Difficult for moderate slope (difference 2) within footprint', () => {
            renderer.buildingType = BuildingType.Lumberjack;
            groundHeight[mapSize.toIndex(4, 4)] = 100;
            groundHeight[mapSize.toIndex(5, 4)] = 102;
            groundHeight[mapSize.toIndex(4, 5)] = 100;
            groundHeight[mapSize.toIndex(5, 5)] = 100;
            expect(renderer.computePlacementStatus(4, 4)).toBe(PlacementStatus.Difficult);
        });

        it('should return TooSteep for steep slope (difference > 2) within footprint', () => {
            renderer.buildingType = BuildingType.Lumberjack;
            groundHeight[mapSize.toIndex(4, 4)] = 100;
            groundHeight[mapSize.toIndex(5, 4)] = 103;
            groundHeight[mapSize.toIndex(4, 5)] = 100;
            groundHeight[mapSize.toIndex(5, 5)] = 100;
            expect(renderer.computePlacementStatus(4, 4)).toBe(PlacementStatus.TooSteep);
        });

        it('should return Occupied when tile is occupied', () => {
            renderer.tileOccupancy.set('5,5', 1);
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.Occupied);
        });

        // Territory checks are currently disabled (ENABLE_TERRITORY_CHECKS = false)
        it.skip('should return EnemyTerritory when in enemy territory', () => {
            renderer.hasBuildings = true;
            renderer.player = 0;
            renderer.territory = new TerritoryMap(mapSize);
            renderer.territory.owner[mapSize.toIndex(5, 5)] = 1;
            expect(renderer.computePlacementStatus(5, 5)).toBe(PlacementStatus.EnemyTerritory);
        });
    });

    describe('getStatusDescription', () => {
        it('should return descriptions for all statuses', () => {
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.Easy))
                .toBe('Can build: Flat terrain');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.Medium))
                .toBe('Can build: Slight slope');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.Difficult))
                .toBe('Can build: Uneven terrain');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.TooSteep))
                .toBe('Cannot build: Too steep');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.InvalidTerrain))
                .toBe('Cannot build: Invalid terrain');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.Occupied))
                .toBe('Cannot build: Occupied');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.EnemyTerritory))
                .toBe('Cannot build: Enemy territory');
            expect(BuildingIndicatorRenderer.getStatusDescription(PlacementStatus.OutsideTerritory))
                .toBe('Cannot build: Outside territory');
        });
    });

    describe('getStatusColor', () => {
        it('should return different colors for different statuses', () => {
            const easyColor = BuildingIndicatorRenderer.getStatusColor(PlacementStatus.Easy);
            const invalidColor = BuildingIndicatorRenderer.getStatusColor(PlacementStatus.InvalidTerrain);

            expect(easyColor[1]).toBeGreaterThan(easyColor[0]); // greenish
            expect(invalidColor[0]).toBeGreaterThan(invalidColor[1]); // reddish
        });
    });

    describe('isBuildableStatus', () => {
        it('should return true only for buildable statuses', () => {
            expect(isBuildableStatus(PlacementStatus.Easy)).toBe(true);
            expect(isBuildableStatus(PlacementStatus.Medium)).toBe(true);
            expect(isBuildableStatus(PlacementStatus.Difficult)).toBe(true);
        });

        it('should return false for non-buildable statuses (no indicator shown)', () => {
            expect(isBuildableStatus(PlacementStatus.InvalidTerrain)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.Occupied)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.EnemyTerritory)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.OutsideTerritory)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.TooSteep)).toBe(false);
        });
    });
});

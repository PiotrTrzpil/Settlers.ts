import { describe, it, expect, beforeEach } from 'vitest';
import {
    BuildingIndicatorRenderer,
    PlacementStatus,
    isBuildableStatus
} from '@/game/renderer/building-indicator-renderer';
import { MapSize } from '@/utilities/map-size';
import { TerritoryMap } from '@/game/systems/territory';
import { BuildingType } from '@/game/entity';

describe('BuildingIndicatorRenderer', () => {
    let mapSize: MapSize;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;
    let renderer: BuildingIndicatorRenderer;

    beforeEach(() => {
        mapSize = new MapSize(10, 10);
        groundType = new Uint8Array(100);
        groundHeight = new Uint8Array(100);

        // Default to buildable grass terrain (16)
        groundType.fill(16);
        // Default to flat terrain
        groundHeight.fill(100);

        renderer = new BuildingIndicatorRenderer(mapSize, groundType, groundHeight);
        // Set a default building type for tests (1x1 decoration for simplicity)
        renderer.buildingType = BuildingType.Decoration;
    });

    describe('computePlacementStatus', () => {
        it('should return Easy for flat buildable terrain', () => {
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.Easy);
        });

        it('should return InvalidTerrain for water', () => {
            groundType[mapSize.toIndex(5, 5)] = 0; // Water
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return InvalidTerrain for rock', () => {
            groundType[mapSize.toIndex(5, 5)] = 32; // Rock
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return InvalidTerrain for beach', () => {
            groundType[mapSize.toIndex(5, 5)] = 48; // Beach
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return InvalidTerrain for swamp', () => {
            groundType[mapSize.toIndex(5, 5)] = 80; // Swamp
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.InvalidTerrain);
        });

        it('should return Medium for slight slope (difference 1) within footprint', () => {
            // Use a 2x2 building (Lumberjack) to test slope within footprint
            renderer.buildingType = BuildingType.Lumberjack;
            // Create a slight slope within the 2x2 footprint at (4,4)
            // Tiles: (4,4), (5,4), (4,5), (5,5)
            groundHeight[mapSize.toIndex(4, 4)] = 100;
            groundHeight[mapSize.toIndex(5, 4)] = 101; // +1 height diff
            groundHeight[mapSize.toIndex(4, 5)] = 100;
            groundHeight[mapSize.toIndex(5, 5)] = 100;
            const status = renderer.computePlacementStatus(4, 4);
            expect(status).toBe(PlacementStatus.Medium);
        });

        it('should return Difficult for moderate slope (difference 2) within footprint', () => {
            renderer.buildingType = BuildingType.Lumberjack;
            groundHeight[mapSize.toIndex(4, 4)] = 100;
            groundHeight[mapSize.toIndex(5, 4)] = 102; // +2 height diff
            groundHeight[mapSize.toIndex(4, 5)] = 100;
            groundHeight[mapSize.toIndex(5, 5)] = 100;
            const status = renderer.computePlacementStatus(4, 4);
            expect(status).toBe(PlacementStatus.Difficult);
        });

        it('should return TooSteep for steep slope (difference > 2) within footprint', () => {
            renderer.buildingType = BuildingType.Lumberjack;
            groundHeight[mapSize.toIndex(4, 4)] = 100;
            groundHeight[mapSize.toIndex(5, 4)] = 103; // +3 height diff
            groundHeight[mapSize.toIndex(4, 5)] = 100;
            groundHeight[mapSize.toIndex(5, 5)] = 100;
            const status = renderer.computePlacementStatus(4, 4);
            expect(status).toBe(PlacementStatus.TooSteep);
        });

        it('should return Occupied when tile is occupied', () => {
            renderer.tileOccupancy.set('5,5', 1);
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.Occupied);
        });

        // Territory checks are currently disabled (ENABLE_TERRITORY_CHECKS = false)
        it.skip('should return EnemyTerritory when in enemy territory', () => {
            renderer.hasBuildings = true;
            renderer.player = 0;
            renderer.territory = new TerritoryMap(mapSize);
            // Simulate enemy territory by setting ownership
            renderer.territory.owner[mapSize.toIndex(5, 5)] = 1;
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.EnemyTerritory);
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

            // Easy should be greenish (higher G than R)
            expect(easyColor[1]).toBeGreaterThan(easyColor[0]);

            // Invalid should be reddish (higher R than G)
            expect(invalidColor[0]).toBeGreaterThan(invalidColor[1]);
        });
    });

    describe('isBuildableStatus', () => {
        it('should return true only for buildable statuses', () => {
            // These should show indicators (can build here)
            expect(isBuildableStatus(PlacementStatus.Easy)).toBe(true);
            expect(isBuildableStatus(PlacementStatus.Medium)).toBe(true);
            expect(isBuildableStatus(PlacementStatus.Difficult)).toBe(true);
        });

        it('should return false for non-buildable statuses (no indicator shown)', () => {
            // These should NOT show indicators (cannot build here)
            expect(isBuildableStatus(PlacementStatus.InvalidTerrain)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.Occupied)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.EnemyTerritory)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.OutsideTerritory)).toBe(false);
            expect(isBuildableStatus(PlacementStatus.TooSteep)).toBe(false);
        });
    });
});

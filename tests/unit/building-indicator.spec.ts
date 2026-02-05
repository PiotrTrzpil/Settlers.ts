import { describe, it, expect, beforeEach } from 'vitest';
import {
    BuildingIndicatorRenderer,
    PlacementStatus
} from '@/game/renderer/building-indicator-renderer';
import { MapSize } from '@/utilities/map-size';
import { TerritoryMap } from '@/game/systems/territory';

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

        it('should return Medium for slight slope (difference 1)', () => {
            // Create a slight slope
            groundHeight[mapSize.toIndex(5, 4)] = 101;
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.Medium);
        });

        it('should return Difficult for moderate slope (difference 2)', () => {
            // Create a moderate slope
            groundHeight[mapSize.toIndex(5, 4)] = 102;
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.Difficult);
        });

        it('should return TooSteep for steep slope (difference > 2)', () => {
            // Create a steep slope
            groundHeight[mapSize.toIndex(5, 4)] = 103;
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.TooSteep);
        });

        it('should return Occupied when tile is occupied', () => {
            renderer.tileOccupancy.set('5,5', 1);
            const status = renderer.computePlacementStatus(5, 5);
            expect(status).toBe(PlacementStatus.Occupied);
        });

        it('should return EnemyTerritory when in enemy territory', () => {
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
});

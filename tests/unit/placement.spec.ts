import { describe, it, expect, beforeEach } from 'vitest';
import { canPlaceBuilding, isPassable, isBuildable } from '@/game/systems/placement';
import { MapSize } from '@/utilities/map-size';

describe('Building Placement', () => {
    describe('isPassable', () => {
        it('should return false for water (0-8)', () => {
            for (let i = 0; i <= 8; i++) {
                expect(isPassable(i)).toBe(false);
            }
        });

        it('should return false for rock (32)', () => {
            expect(isPassable(32)).toBe(false);
        });

        it('should return true for grass (16)', () => {
            expect(isPassable(16)).toBe(true);
        });

        it('should return true for beach (48)', () => {
            expect(isPassable(48)).toBe(true);
        });

        it('should return true for desert (64)', () => {
            expect(isPassable(64)).toBe(true);
        });
    });

    describe('isBuildable', () => {
        it('should return true for grass (16)', () => {
            expect(isBuildable(16)).toBe(true);
        });

        it('should return true for desert (64)', () => {
            expect(isBuildable(64)).toBe(true);
        });

        it('should return false for water (0)', () => {
            expect(isBuildable(0)).toBe(false);
        });

        it('should return false for rock (32)', () => {
            expect(isBuildable(32)).toBe(false);
        });

        it('should return false for beach (48)', () => {
            expect(isBuildable(48)).toBe(false);
        });

        it('should return false for swamp (80)', () => {
            expect(isBuildable(80)).toBe(false);
        });

        it('should return false for snow (128)', () => {
            expect(isBuildable(128)).toBe(false);
        });
    });

    describe('canPlaceBuilding', () => {
        let mapSize: MapSize;
        let groundType: Uint8Array;
        let groundHeight: Uint8Array;
        let occupancy: Map<string, number>;

        beforeEach(() => {
            mapSize = new MapSize(64, 64);
            groundType = new Uint8Array(64 * 64);
            groundHeight = new Uint8Array(64 * 64);
            groundType.fill(16); // all grass
            occupancy = new Map();
        });

        it('should allow placement on flat grass', () => {
            expect(canPlaceBuilding(groundType, groundHeight, mapSize, occupancy, 10, 10)).toBe(true);
        });

        it('should reject placement on water', () => {
            groundType[mapSize.toIndex(10, 10)] = 0;
            expect(canPlaceBuilding(groundType, groundHeight, mapSize, occupancy, 10, 10)).toBe(false);
        });

        it('should reject placement on occupied tile', () => {
            occupancy.set('10,10', 1);
            expect(canPlaceBuilding(groundType, groundHeight, mapSize, occupancy, 10, 10)).toBe(false);
        });

        it('should reject placement on steep slope', () => {
            groundHeight[mapSize.toIndex(10, 10)] = 10;
            groundHeight[mapSize.toIndex(11, 10)] = 0;
            expect(canPlaceBuilding(groundType, groundHeight, mapSize, occupancy, 10, 10)).toBe(false);
        });

        it('should allow placement on gentle slope', () => {
            groundHeight[mapSize.toIndex(10, 10)] = 5;
            groundHeight[mapSize.toIndex(11, 10)] = 4;
            groundHeight[mapSize.toIndex(9, 10)] = 4;
            groundHeight[mapSize.toIndex(10, 11)] = 4;
            groundHeight[mapSize.toIndex(10, 9)] = 4;
            expect(canPlaceBuilding(groundType, groundHeight, mapSize, occupancy, 10, 10)).toBe(true);
        });
    });
});

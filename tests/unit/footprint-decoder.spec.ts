import { describe, it, expect } from 'vitest';
import {
    decodeBuildingFootprint,
    getFootprintBounds,
} from '@/resources/game-data/footprint-decoder';

describe('footprint-decoder', () => {
    describe('decodeBuildingFootprint', () => {
        it('should decode a simple 2x2 footprint', () => {
            // Two rows with bits 30,31 set (positions 0,1)
            // 0xC0000000 = bits 30,31 set = -1073741824 as signed int
            const buildingPosLines = [
                0xC0000000 >>> 0, // row 0: bits 30,31
                0xC0000000 >>> 0, // row 1: bits 30,31
            ];
            // Hotspot at (1, 1) - center of 2x2
            const tiles = decodeBuildingFootprint(buildingPosLines, 1, 1);

            expect(tiles).toHaveLength(4);
            // Tiles relative to hotspot (1,1)
            expect(tiles).toContainEqual({ x: -1, y: -1 }); // (0,0) - (1,1)
            expect(tiles).toContainEqual({ x: 0, y: -1 });  // (1,0) - (1,1)
            expect(tiles).toContainEqual({ x: -1, y: 0 });  // (0,1) - (1,1)
            expect(tiles).toContainEqual({ x: 0, y: 0 });   // (1,1) - (1,1)
        });

        it('should decode single tile at origin', () => {
            // Bit 31 set = position 0
            const buildingPosLines = [0x80000000 >>> 0]; // -2147483648 as signed
            const tiles = decodeBuildingFootprint(buildingPosLines, 0, 0);

            expect(tiles).toHaveLength(1);
            expect(tiles[0]).toEqual({ x: 0, y: 0 });
        });

        it('should handle negative signed integers', () => {
            // -268435456 = 0xF0000000 = bits 28,29,30,31 set
            const buildingPosLines = [-268435456];
            const tiles = decodeBuildingFootprint(buildingPosLines, 0, 0);

            expect(tiles).toHaveLength(4);
            expect(tiles).toContainEqual({ x: 0, y: 0 });
            expect(tiles).toContainEqual({ x: 1, y: 0 });
            expect(tiles).toContainEqual({ x: 2, y: 0 });
            expect(tiles).toContainEqual({ x: 3, y: 0 });
        });

        it('should offset tiles by hotspot', () => {
            // Single bit at position 0
            const buildingPosLines = [0x80000000 >>> 0];
            // Hotspot at (5, 3)
            const tiles = decodeBuildingFootprint(buildingPosLines, 5, 3);

            expect(tiles).toHaveLength(1);
            expect(tiles[0]).toEqual({ x: -5, y: -3 }); // (0,0) - (5,3)
        });

        it('should return empty array for all-zero lines', () => {
            const buildingPosLines = [0, 0, 0];
            const tiles = decodeBuildingFootprint(buildingPosLines, 0, 0);
            expect(tiles).toHaveLength(0);
        });
    });

    describe('getFootprintBounds', () => {
        it('should calculate bounds for simple footprint', () => {
            const tiles = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
                { x: 1, y: 1 },
            ];
            const bounds = getFootprintBounds(tiles);

            expect(bounds.minX).toBe(0);
            expect(bounds.maxX).toBe(1);
            expect(bounds.minY).toBe(0);
            expect(bounds.maxY).toBe(1);
            expect(bounds.width).toBe(2);
            expect(bounds.height).toBe(2);
        });

        it('should handle negative coordinates', () => {
            const tiles = [
                { x: -1, y: -1 },
                { x: 0, y: -1 },
                { x: -1, y: 0 },
                { x: 0, y: 0 },
            ];
            const bounds = getFootprintBounds(tiles);

            expect(bounds.minX).toBe(-1);
            expect(bounds.maxX).toBe(0);
            expect(bounds.minY).toBe(-1);
            expect(bounds.maxY).toBe(0);
            expect(bounds.width).toBe(2);
            expect(bounds.height).toBe(2);
        });

        it('should handle empty array', () => {
            const bounds = getFootprintBounds([]);
            expect(bounds.width).toBe(0);
            expect(bounds.height).toBe(0);
        });

        it('should handle single tile', () => {
            const bounds = getFootprintBounds([{ x: 5, y: 3 }]);
            expect(bounds.minX).toBe(5);
            expect(bounds.maxX).toBe(5);
            expect(bounds.minY).toBe(3);
            expect(bounds.maxY).toBe(3);
            expect(bounds.width).toBe(1);
            expect(bounds.height).toBe(1);
        });
    });
});

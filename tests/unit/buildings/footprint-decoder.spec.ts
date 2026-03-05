import { describe, it, expect } from 'vitest';
import { decodeBuildingFootprint } from '@/resources/game-data/footprint-decoder';

describe('decodeBuildingFootprint', () => {
    it('should decode a 2x2 footprint from bitmask lines relative to hotspot', () => {
        // Two rows with bits 30,31 set (positions 0,1)
        // 0xC0000000 = bits 30,31 set = -1073741824 as signed int
        const buildingPosLines = [
            0xc0000000 >>> 0, // row 0: bits 30,31
            0xc0000000 >>> 0, // row 1: bits 30,31
        ];
        // Hotspot at (1, 1) - center of 2x2
        const tiles = decodeBuildingFootprint(buildingPosLines, 1, 1);

        expect(tiles).toHaveLength(4);
        expect(tiles).toContainEqual({ x: -1, y: -1 });
        expect(tiles).toContainEqual({ x: 0, y: -1 });
        expect(tiles).toContainEqual({ x: -1, y: 0 });
        expect(tiles).toContainEqual({ x: 0, y: 0 });
    });

    it('should handle negative signed integers (0xF0000000 = -268435456)', () => {
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
        const buildingPosLines = [0x80000000 >>> 0]; // Single bit at position 0
        const tiles = decodeBuildingFootprint(buildingPosLines, 5, 3);

        expect(tiles).toHaveLength(1);
        expect(tiles[0]).toEqual({ x: -5, y: -3 });
    });

    it('should return empty array for all-zero lines', () => {
        const tiles = decodeBuildingFootprint([0, 0, 0], 0, 0);
        expect(tiles).toHaveLength(0);
    });
});

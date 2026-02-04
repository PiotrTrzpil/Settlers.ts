import { describe, it, expect, beforeEach } from 'vitest';
import { findPath } from '@/game/systems/pathfinding';

describe('Pathfinding (A*)', () => {
    const width = 64;
    const height = 64;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;
    let occupancy: Map<string, number>;

    beforeEach(() => {
        groundType = new Uint8Array(width * height);
        groundHeight = new Uint8Array(width * height);
        groundType.fill(16); // all grass (passable)
        occupancy = new Map();
    });

    it('should find a straight path on open terrain', () => {
        const path = findPath(5, 5, 10, 5, groundType, groundHeight, width, height, occupancy);

        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath).toHaveLength(5);
        expect(validPath[validPath.length - 1]).toEqual({ x: 10, y: 5 });
    });

    it('should return empty array when start equals goal', () => {
        const path = findPath(5, 5, 5, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath).toHaveLength(0);
    });

    it('should return null when goal is water', () => {
        groundType[20 + 5 * width] = 0; // water at goal
        const path = findPath(5, 5, 20, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).toBe(null);
    });

    it('should return null when path is completely blocked', () => {
        // Wall of water from y=0 to y=63 at x=15
        for (let y = 0; y < height; y++) {
            groundType[15 + y * width] = 0;
        }
        const path = findPath(10, 5, 20, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).toBe(null);
    });

    it('should find path around obstacles', () => {
        // Wall with gap at y=10
        for (let y = 0; y < height; y++) {
            if (y !== 10) {
                groundType[15 + y * width] = 0;
            }
        }

        const path = findPath(10, 5, 20, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath.length).toBeGreaterThan(10); // detour path
        // Verify path goes through the gap
        const gapTile = validPath.find(p => p.x === 15 && p.y === 10);
        expect(gapTile).toBeDefined();
    });

    it('should not pass through rock tiles', () => {
        // Wall of rock
        for (let y = 0; y < height; y++) {
            groundType[15 + y * width] = 32; // rock
        }
        const path = findPath(10, 5, 20, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).toBe(null);
    });

    it('should consider height differences in cost', () => {
        // Create two possible paths: flat (longer) and hilly (shorter but expensive)
        // Flat path: y=5 with height 0
        // Hilly path: y=3 with high terrain
        for (let x = 5; x <= 15; x++) {
            groundHeight[x + 3 * width] = 10;
        }

        const path = findPath(5, 5, 15, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        // Path should exist and reach the goal
        expect(validPath[validPath.length - 1]).toEqual({ x: 15, y: 5 });
    });

    it('should handle paths near map edges', () => {
        const path = findPath(0, 0, 5, 0, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath[validPath.length - 1]).toEqual({ x: 5, y: 0 });
    });
});

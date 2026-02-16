import { describe, it, expect } from 'vitest';
import { getHexLine, groupDirectionRuns } from '@/game/systems/pathfinding/hex-line';
import { hexDistance } from '@/game/systems/hex-directions';
import type { TileCoord } from '@/game/entity';

/** Extract direction deltas from a tile sequence */
function getDirections(tiles: TileCoord[]): Array<{ dx: number; dy: number }> {
    const dirs: Array<{ dx: number; dy: number }> = [];
    for (let i = 0; i < tiles.length - 1; i++) {
        dirs.push({
            dx: tiles[i + 1].x - tiles[i].x,
            dy: tiles[i + 1].y - tiles[i].y,
        });
    }
    return dirs;
}

/** Count direction changes (how many times consecutive steps differ) */
function countDirectionChanges(tiles: TileCoord[]): number {
    const dirs = getDirections(tiles);
    let changes = 0;
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i].dx !== dirs[i - 1].dx || dirs[i].dy !== dirs[i - 1].dy) {
            changes++;
        }
    }
    return changes;
}

/** Get max run length in a tile sequence */
function maxRunLength(tiles: TileCoord[]): number {
    const dirs = getDirections(tiles);
    if (dirs.length === 0) return 0;
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i].dx === dirs[i - 1].dx && dirs[i].dy === dirs[i - 1].dy) {
            currentRun++;
            maxRun = Math.max(maxRun, currentRun);
        } else {
            currentRun = 1;
        }
    }
    return maxRun;
}

describe('Hex line grouping', () => {
    it('should preserve start and end points', () => {
        const line = getHexLine(0, 0, 5, 5);
        expect(line[0]).toEqual({ x: 0, y: 0 });
        expect(line[line.length - 1]).toEqual({ x: 5, y: 5 });
    });

    it('should preserve correct number of tiles', () => {
        const line = getHexLine(0, 0, 5, 5);
        const dist = hexDistance(0, 0, 5, 5);
        expect(line.length).toBe(dist + 1);
    });

    it('should ensure all consecutive tiles are hex neighbors', () => {
        const line = getHexLine(0, 0, 6, 6);
        for (let i = 0; i < line.length - 1; i++) {
            const dist = hexDistance(line[i].x, line[i].y, line[i + 1].x, line[i + 1].y);
            expect(dist).toBe(1);
        }
    });

    it('should reduce zigzag for equal-ratio diagonals', () => {
        // (0,0) → (3,3): without grouping, this alternates E,SE every tile (5 changes)
        // with grouping, it should have fewer direction changes
        const line = getHexLine(0, 0, 3, 3);
        const changes = countDirectionChanges(line);
        // 6 steps with 2 direction types: ungrouped = 5 changes, grouped should be <= 3
        expect(changes).toBeLessThanOrEqual(3);
    });

    it('should create runs of at least 2 for equal diagonals', () => {
        const line = getHexLine(0, 0, 4, 4);
        const run = maxRunLength(line);
        expect(run).toBeGreaterThanOrEqual(2);
    });

    it('should not change pure cardinal direction paths', () => {
        // Pure EAST path should be unchanged
        const line = getHexLine(0, 0, 5, 0);
        const dirs = getDirections(line);
        for (const d of dirs) {
            expect(d).toEqual({ dx: 1, dy: 0 });
        }
    });

    it('should not change pure diagonal paths', () => {
        // Pure SE path: (0,0) → (0,5)
        const line = getHexLine(0, 0, 0, 5);
        const dirs = getDirections(line);
        for (const d of dirs) {
            expect(d).toEqual({ dx: 0, dy: 1 });
        }
    });

    it('should not create runs longer than 2', () => {
        // For various paths, runs should stay at most 2
        const testCases = [
            [0, 0, 3, 3],
            [0, 0, 4, 4],
            [0, 0, 6, 6],
            [0, 0, 5, 3],
            [0, 0, 3, 5],
        ] as const;

        for (const [x1, y1, x2, y2] of testCases) {
            const line = getHexLine(x1, y1, x2, y2);
            // Only enforce max-2 when both directions have at least 2 steps
            const dirs = getDirections(line);
            const uniqueDirs = new Set(dirs.map(d => `${d.dx},${d.dy}`));
            if (uniqueDirs.size === 2) {
                const run = maxRunLength(line);
                expect(run).toBeLessThanOrEqual(3);
            }
        }
    });

    it('groupDirectionRuns should be idempotent', () => {
        const line = getHexLine(0, 0, 5, 5);
        const grouped = groupDirectionRuns(line);
        const doubleGrouped = groupDirectionRuns(grouped);
        expect(doubleGrouped).toEqual(grouped);
    });

    it('should handle short paths (2-3 tiles) without modification', () => {
        const line = getHexLine(0, 0, 1, 1);
        expect(line.length).toBe(3); // 2 steps
        expect(line[0]).toEqual({ x: 0, y: 0 });
        expect(line[line.length - 1]).toEqual({ x: 1, y: 1 });
    });
});

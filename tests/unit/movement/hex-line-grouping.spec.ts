import { describe, it, expect, beforeEach } from 'vitest';
import { getHexLine, groupDirectionRuns, setDirectionRunLength } from '@/game/systems/pathfinding/hex-line';
import { hexDistance } from '@/game/systems/hex-directions';
import type { TileCoord } from '@/game/entity';

/** Extract direction deltas from a tile sequence */
function getDirections(tiles: TileCoord[]): Array<{ dx: number; dy: number }> {
    const dirs: Array<{ dx: number; dy: number }> = [];
    for (let i = 0; i < tiles.length - 1; i++) {
        dirs.push({
            dx: tiles[i + 1]!.x - tiles[i]!.x,
            dy: tiles[i + 1]!.y - tiles[i]!.y,
        });
    }
    return dirs;
}

/** Count direction changes (how many times consecutive steps differ) */
function countDirectionChanges(tiles: TileCoord[]): number {
    const dirs = getDirections(tiles);
    let changes = 0;
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i]!.dx !== dirs[i - 1]!.dx || dirs[i]!.dy !== dirs[i - 1]!.dy) {
            changes++;
        }
    }
    return changes;
}

/** Get max run length in a tile sequence */
function getMaxRunLength(tiles: TileCoord[]): number {
    const dirs = getDirections(tiles);
    if (dirs.length === 0) return 0;
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i]!.dx === dirs[i - 1]!.dx && dirs[i]!.dy === dirs[i - 1]!.dy) {
            currentRun++;
            maxRun = Math.max(maxRun, currentRun);
        } else {
            currentRun = 1;
        }
    }
    return maxRun;
}

describe('Hex line grouping', () => {
    beforeEach(() => {
        // Reset to default for each test
        setDirectionRunLength(8);
    });

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
            const dist = hexDistance(line[i]!.x, line[i]!.y, line[i + 1]!.x, line[i + 1]!.y);
            expect(dist).toBe(1);
        }
    });

    it('should reduce zigzag for equal-ratio diagonals', () => {
        const line = getHexLine(0, 0, 3, 3);
        const changes = countDirectionChanges(line);
        // Default run length 8 means very few direction changes
        expect(changes).toBeLessThanOrEqual(2);
    });

    it('should create runs of at least 2 for equal diagonals', () => {
        const line = getHexLine(0, 0, 4, 4);
        const run = getMaxRunLength(line);
        expect(run).toBeGreaterThanOrEqual(2);
    });

    it('should not change pure cardinal direction paths', () => {
        const line = getHexLine(0, 0, 5, 0);
        const dirs = getDirections(line);
        for (const d of dirs) {
            expect(d).toEqual({ dx: 1, dy: 0 });
        }
    });

    it('should not change pure diagonal paths', () => {
        const line = getHexLine(0, 0, 0, 5);
        const dirs = getDirections(line);
        for (const d of dirs) {
            expect(d).toEqual({ dx: 0, dy: 1 });
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

describe('Configurable direction run length', () => {
    beforeEach(() => {
        setDirectionRunLength(8);
    });

    it('maxRunLength=1 should return raw interpolation order (no regrouping)', () => {
        // With maxRunLength=1, groupDirectionRuns returns tiles unchanged
        const line = getHexLine(0, 0, 4, 4);
        const regrouped = groupDirectionRuns(line, 1);

        // Should be identical to input (no regrouping applied)
        expect(regrouped).toEqual(line);
    });

    it('maxRunLength=2 should create short runs', () => {
        const line = getHexLine(0, 0, 6, 6);
        const regrouped = groupDirectionRuns(line, 2);
        const run = getMaxRunLength(regrouped);
        expect(run).toBeLessThanOrEqual(2);
    });

    it('maxRunLength=8 should create longer runs', () => {
        const line = getHexLine(0, 0, 10, 10);
        const regrouped = groupDirectionRuns(line, 8);
        const run = getMaxRunLength(regrouped);
        expect(run).toBeGreaterThanOrEqual(4);
        expect(run).toBeLessThanOrEqual(10);
    });

    it('large maxRunLength should group all same-direction steps together', () => {
        const line = getHexLine(0, 0, 5, 5);
        const regrouped = groupDirectionRuns(line, 50);
        const changes = countDirectionChanges(regrouped);
        // With a very large run length, should have exactly 1 direction change
        expect(changes).toBe(1);
    });

    it('should preserve start and end points for all run lengths', () => {
        const rawLine = getHexLine(0, 0, 7, 4);
        for (const len of [1, 2, 5, 10, 50]) {
            const regrouped = groupDirectionRuns(rawLine, len);
            expect(regrouped[0]).toEqual({ x: 0, y: 0 });
            expect(regrouped[regrouped.length - 1]).toEqual({ x: 7, y: 4 });
        }
    });

    it('should preserve tile count for all run lengths', () => {
        const rawLine = getHexLine(0, 0, 7, 4);
        for (const len of [1, 2, 5, 10, 50]) {
            const regrouped = groupDirectionRuns(rawLine, len);
            expect(regrouped.length).toBe(rawLine.length);
        }
    });

    it('should produce valid hex neighbors for all run lengths', () => {
        const rawLine = getHexLine(0, 0, 8, 5);
        for (const len of [1, 2, 3, 5, 8, 20]) {
            const regrouped = groupDirectionRuns(rawLine, len);
            for (let i = 0; i < regrouped.length - 1; i++) {
                const dist = hexDistance(regrouped[i]!.x, regrouped[i]!.y, regrouped[i + 1]!.x, regrouped[i + 1]!.y);
                expect(dist).toBe(1);
            }
        }
    });

    it('module-level setDirectionRunLength affects getHexLine output', () => {
        setDirectionRunLength(2);
        const lineShort = getHexLine(0, 0, 6, 6);
        const runShort = getMaxRunLength(lineShort);

        setDirectionRunLength(20);
        const lineLong = getHexLine(0, 0, 6, 6);
        const runLong = getMaxRunLength(lineLong);

        expect(runLong).toBeGreaterThanOrEqual(runShort);
    });

    it('higher run length should produce fewer direction changes', () => {
        setDirectionRunLength(1);
        const line1 = getHexLine(0, 0, 10, 10);
        const changes1 = countDirectionChanges(line1);

        setDirectionRunLength(10);
        const line10 = getHexLine(0, 0, 10, 10);
        const changes10 = countDirectionChanges(line10);

        expect(changes10).toBeLessThanOrEqual(changes1);
    });
});

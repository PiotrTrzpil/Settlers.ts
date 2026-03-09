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
        setDirectionRunLength(8);
    });

    it('should preserve invariants: start/end points, tile count, and valid hex neighbors', () => {
        const testCases: Array<[number, number, number, number]> = [
            [0, 0, 5, 5],
            [0, 0, 6, 6],
            [0, 0, 7, 4],
        ];

        for (const [x1, y1, x2, y2] of testCases) {
            const line = getHexLine(x1, y1, x2, y2);
            expect(line[0]).toEqual({ x: x1, y: y1 });
            expect(line[line.length - 1]).toEqual({ x: x2, y: y2 });

            const dist = hexDistance(x1, y1, x2, y2);
            expect(line.length).toBe(dist + 1);

            for (let i = 0; i < line.length - 1; i++) {
                const stepDist = hexDistance(line[i]!.x, line[i]!.y, line[i + 1]!.x, line[i + 1]!.y);
                expect(stepDist).toBe(1);
            }
        }
    });

    it('should not change pure cardinal or pure diagonal paths', () => {
        // Pure east
        const eastLine = getHexLine(0, 0, 5, 0);
        for (const d of getDirections(eastLine)) {
            expect(d).toEqual({ dx: 1, dy: 0 });
        }

        // Pure SE
        const seLine = getHexLine(0, 0, 0, 5);
        for (const d of getDirections(seLine)) {
            expect(d).toEqual({ dx: 0, dy: 1 });
        }
    });

    it('should reduce zigzag for equal-ratio diagonals', () => {
        const line = getHexLine(0, 0, 3, 3);
        const changes = countDirectionChanges(line);
        expect(changes).toBeLessThanOrEqual(2);
    });

    it('groupDirectionRuns should be idempotent', () => {
        const line = getHexLine(0, 0, 5, 5);
        const grouped = groupDirectionRuns(line);
        const doubleGrouped = groupDirectionRuns(grouped);
        expect(doubleGrouped).toEqual(grouped);
    });

    it('run length controls grouping behavior', () => {
        // Use a target that requires mixed directions (different-sign dx/dy)
        const rawLine = getHexLine(0, 0, 10, -10);

        // maxRunLength=1: no regrouping (raw interpolation order)
        const noGroup = groupDirectionRuns(rawLine, 1);
        expect(noGroup).toEqual(rawLine);

        // maxRunLength=2: short runs
        const shortRuns = groupDirectionRuns(rawLine, 2);
        expect(getMaxRunLength(shortRuns)).toBeLessThanOrEqual(2);

        // Large run length on a same-sign diagonal: groups all same-direction steps together
        const longRuns = groupDirectionRuns(getHexLine(0, 0, 5, 5), 50);
        expect(countDirectionChanges(longRuns)).toBe(0); // all steps in one direction
    });

    it('should preserve invariants for all run lengths', () => {
        const rawLine = getHexLine(0, 0, 8, 5);
        for (const len of [1, 2, 3, 5, 8, 20]) {
            const regrouped = groupDirectionRuns(rawLine, len);

            // Same start, end, and length
            expect(regrouped[0]).toEqual({ x: 0, y: 0 });
            expect(regrouped[regrouped.length - 1]).toEqual({ x: 8, y: 5 });
            expect(regrouped.length).toBe(rawLine.length);

            // All consecutive tiles are valid hex neighbors
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

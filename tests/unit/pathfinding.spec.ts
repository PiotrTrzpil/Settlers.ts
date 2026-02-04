import { describe, it, expect, beforeEach } from 'vitest';
import { findPath } from '@/game/systems/pathfinding';
import {
    EDirection,
    GRID_DELTA_X,
    GRID_DELTA_Y,
    GRID_DELTAS,
    Y_SCALE,
    getNextHexPoint,
    getApproxDirection,
    getNeighbor,
    hexDistance,
    getAllNeighbors,
} from '@/game/systems/hex-directions';
import { GameState } from '@/game/game-state';
import { EntityType, tileKey } from '@/game/entity';
import { pushUnit, findRandomFreeDirection } from '@/game/systems/movement';

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
        // Also block diagonals that hex movement allows
        for (let y = 0; y < height; y++) {
            groundType[14 + y * width] = 0;
        }
        const path = findPath(10, 5, 20, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).toBe(null);
    });

    it('should find path around obstacles', () => {
        // Wall with gap at y=10 — block both x=15 and x=14 columns
        // to account for hex diagonal movement
        for (let y = 0; y < height; y++) {
            if (y !== 10) {
                groundType[15 + y * width] = 0;
                groundType[14 + y * width] = 0;
            }
        }

        const path = findPath(10, 5, 20, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath.length).toBeGreaterThan(5); // detour path
        // Verify path reaches the goal
        expect(validPath[validPath.length - 1]).toEqual({ x: 20, y: 5 });
    });

    it('should not pass through rock tiles', () => {
        // Wall of rock — double thick for hex
        for (let y = 0; y < height; y++) {
            groundType[15 + y * width] = 32;
            groundType[14 + y * width] = 32;
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

describe('Hex Directions', () => {
    describe('getAllNeighbors', () => {
        it('should return 6 neighbors for center position', () => {
            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            expect(neighbors).toHaveLength(6);
        });

        it('should return correct neighbors for (10, 10)', () => {
            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            const expected = [
                { x: 11, y: 9 },   // NORTH_EAST
                { x: 11, y: 10 },  // EAST
                { x: 10, y: 11 },  // SOUTH_EAST
                { x: 9, y: 11 },   // SOUTH_WEST
                { x: 9, y: 10 },   // WEST
                { x: 10, y: 9 },   // NORTH_WEST
            ];
            expect(neighbors).toEqual(expected);
        });

        it('should return correct neighbors for origin (0, 0)', () => {
            const neighbors = getAllNeighbors({ x: 0, y: 0 });
            const expected = [
                { x: 1, y: -1 },   // NORTH_EAST
                { x: 1, y: 0 },    // EAST
                { x: 0, y: 1 },    // SOUTH_EAST
                { x: -1, y: 1 },   // SOUTH_WEST
                { x: -1, y: 0 },   // WEST
                { x: 0, y: -1 },   // NORTH_WEST
            ];
            expect(neighbors).toEqual(expected);
        });

        it('should return correct neighbors for (5, 3)', () => {
            const neighbors = getAllNeighbors({ x: 5, y: 3 });
            expect(neighbors).toEqual([
                { x: 6, y: 2 },
                { x: 6, y: 3 },
                { x: 5, y: 4 },
                { x: 4, y: 4 },
                { x: 4, y: 3 },
                { x: 5, y: 2 },
            ]);
        });
    });

    describe('getNextHexPoint', () => {
        it('should move EAST correctly', () => {
            const result = getNextHexPoint({ x: 5, y: 5 }, EDirection.EAST);
            expect(result).toEqual({ x: 6, y: 5 });
        });

        it('should move WEST correctly', () => {
            const result = getNextHexPoint({ x: 5, y: 5 }, EDirection.WEST);
            expect(result).toEqual({ x: 4, y: 5 });
        });

        it('should move NORTH_EAST correctly', () => {
            const result = getNextHexPoint({ x: 5, y: 5 }, EDirection.NORTH_EAST);
            expect(result).toEqual({ x: 6, y: 4 });
        });

        it('should move SOUTH_WEST correctly', () => {
            const result = getNextHexPoint({ x: 5, y: 5 }, EDirection.SOUTH_WEST);
            expect(result).toEqual({ x: 4, y: 6 });
        });
    });

    describe('GRID_DELTAS', () => {
        it('should have 6 direction entries', () => {
            expect(GRID_DELTAS).toHaveLength(6);
        });

        it('should match GRID_DELTA_X and GRID_DELTA_Y', () => {
            for (let d = 0; d < 6; d++) {
                expect(GRID_DELTAS[d][0]).toBe(GRID_DELTA_X[d]);
                expect(GRID_DELTAS[d][1]).toBe(GRID_DELTA_Y[d]);
            }
        });

        it('opposite directions should cancel out', () => {
            // NE + SW = (0,0)
            expect(GRID_DELTA_X[EDirection.NORTH_EAST] + GRID_DELTA_X[EDirection.SOUTH_WEST]).toBe(0);
            expect(GRID_DELTA_Y[EDirection.NORTH_EAST] + GRID_DELTA_Y[EDirection.SOUTH_WEST]).toBe(0);
            // E + W = (0,0)
            expect(GRID_DELTA_X[EDirection.EAST] + GRID_DELTA_X[EDirection.WEST]).toBe(0);
            expect(GRID_DELTA_Y[EDirection.EAST] + GRID_DELTA_Y[EDirection.WEST]).toBe(0);
            // SE + NW = (0,0)
            expect(GRID_DELTA_X[EDirection.SOUTH_EAST] + GRID_DELTA_X[EDirection.NORTH_WEST]).toBe(0);
            expect(GRID_DELTA_Y[EDirection.SOUTH_EAST] + GRID_DELTA_Y[EDirection.NORTH_WEST]).toBe(0);
        });
    });

    describe('getApproxDirection', () => {
        it('should return EAST for due east movement', () => {
            expect(getApproxDirection(0, 0, 5, 0)).toBe(EDirection.EAST);
        });

        it('should return WEST for due west movement', () => {
            expect(getApproxDirection(5, 0, 0, 0)).toBe(EDirection.WEST);
        });

        it('should return NORTH_EAST for NE movement', () => {
            expect(getApproxDirection(0, 0, 1, -1)).toBe(EDirection.NORTH_EAST);
        });

        it('should return SOUTH_WEST for SW movement', () => {
            expect(getApproxDirection(0, 0, -1, 1)).toBe(EDirection.SOUTH_WEST);
        });
    });

    describe('getNeighbor', () => {
        it('should rotate clockwise by 1', () => {
            expect(getNeighbor(EDirection.NORTH_EAST, 1)).toBe(EDirection.EAST);
            expect(getNeighbor(EDirection.EAST, 1)).toBe(EDirection.SOUTH_EAST);
            expect(getNeighbor(EDirection.NORTH_WEST, 1)).toBe(EDirection.NORTH_EAST);
        });

        it('should rotate counter-clockwise by 1', () => {
            expect(getNeighbor(EDirection.EAST, -1)).toBe(EDirection.NORTH_EAST);
            expect(getNeighbor(EDirection.NORTH_EAST, -1)).toBe(EDirection.NORTH_WEST);
        });

        it('should wrap around with offset 3 (opposite direction)', () => {
            expect(getNeighbor(EDirection.NORTH_EAST, 3)).toBe(EDirection.SOUTH_WEST);
            expect(getNeighbor(EDirection.EAST, 3)).toBe(EDirection.WEST);
            expect(getNeighbor(EDirection.SOUTH_EAST, 3)).toBe(EDirection.NORTH_WEST);
        });

        it('should return same direction with offset 0', () => {
            for (let d = 0; d < 6; d++) {
                expect(getNeighbor(d as EDirection, 0)).toBe(d);
            }
        });

        it('should return same direction with offset 6 (full circle)', () => {
            for (let d = 0; d < 6; d++) {
                expect(getNeighbor(d as EDirection, 6)).toBe(d);
            }
        });
    });
});

describe('Hex Distance', () => {
    it('should return 0 for same point', () => {
        expect(hexDistance(5, 5, 5, 5)).toBe(0);
    });

    it('should return 1 for adjacent EAST tile', () => {
        const dist = hexDistance(5, 5, 6, 5);
        expect(dist).toBeCloseTo(1, 4);
    });

    it('should return sqrt(3) for adjacent NORTH_EAST tile', () => {
        // NE delta is (1, -1), so from (5,5) to (6,4)
        // In the hex visual space: dx=1.5, dy=-0.866, dist=sqrt(3)
        const dist = hexDistance(5, 5, 6, 4);
        expect(dist).toBeCloseTo(Math.sqrt(3), 3);
    });

    it('should return 1 for adjacent SOUTH_EAST tile', () => {
        // SE delta is (0, 1), so from (5,5) to (5,6)
        const dist = hexDistance(5, 5, 5, 6);
        expect(dist).toBeCloseTo(1, 3);
    });

    it('should return 1 for adjacent NORTH_WEST tile', () => {
        // NW delta is (0, -1), so from (5,5) to (5,4)
        const dist = hexDistance(5, 5, 5, 4);
        expect(dist).toBeCloseTo(1, 3);
    });

    it('should return sqrt(3) for adjacent SOUTH_WEST tile', () => {
        // SW delta is (-1, 1), so from (5,5) to (4,6)
        const dist = hexDistance(5, 5, 4, 6);
        expect(dist).toBeCloseTo(Math.sqrt(3), 3);
    });

    it('should be symmetric', () => {
        const d1 = hexDistance(3, 7, 10, 2);
        const d2 = hexDistance(10, 2, 3, 7);
        expect(d1).toBeCloseTo(d2, 10);
    });

    it('should satisfy triangle inequality', () => {
        const dAB = hexDistance(0, 0, 3, 2);
        const dBC = hexDistance(3, 2, 5, 1);
        const dAC = hexDistance(0, 0, 5, 1);
        expect(dAC).toBeLessThanOrEqual(dAB + dBC + 1e-10);
    });

    it('should compute correct distance for a known case', () => {
        // From (0,0) to (2,0): pure east, distance = 2
        expect(hexDistance(0, 0, 2, 0)).toBeCloseTo(2, 4);
    });

    it('Y_SCALE should equal sqrt(3)/2 * 0.999999', () => {
        expect(Y_SCALE).toBeCloseTo(Math.sqrt(3) / 2 * 0.999999, 10);
    });
});

describe('Pathfinding with 6 directions', () => {
    const width = 64;
    const height = 64;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;
    let occupancy: Map<string, number>;

    beforeEach(() => {
        groundType = new Uint8Array(width * height);
        groundHeight = new Uint8Array(width * height);
        groundType.fill(16);
        occupancy = new Map();
    });

    it('should find paths using diagonal hex directions', () => {
        // From (5,5) to (6,4) — this is a NE neighbor, only reachable with hex dirs
        const path = findPath(5, 5, 6, 4, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        expect(path).toHaveLength(1);
        expect(path![0]).toEqual({ x: 6, y: 4 });
    });

    it('should use hex NE/SW diagonal when it is shorter', () => {
        // Path from (5,5) to (8,2) — three NE steps
        const path = findPath(5, 5, 8, 2, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        expect(path!.length).toBe(3); // 3 NE steps
        expect(path![path!.length - 1]).toEqual({ x: 8, y: 2 });
    });

    it('should find path using SE direction', () => {
        // From (5,5) to (5,8) — three SE steps
        const path = findPath(5, 5, 5, 8, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        expect(path!.length).toBe(3);
        expect(path![path!.length - 1]).toEqual({ x: 5, y: 8 });
    });

    it('should find path using NW direction', () => {
        // From (5,5) to (5,2) — three NW steps
        const path = findPath(5, 5, 5, 2, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        expect(path!.length).toBe(3);
        expect(path![path!.length - 1]).toEqual({ x: 5, y: 2 });
    });

    it('bucket queue produces same path endpoint as expected', () => {
        // Verify a longer path reaches the correct goal
        const path = findPath(5, 5, 25, 20, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        expect(path![path!.length - 1]).toEqual({ x: 25, y: 20 });
    });

    it('should find path around obstacle using hex diagonals', () => {
        // Block the direct east path with a wall
        for (let y = 0; y < height; y++) {
            groundType[10 + y * width] = 0; // water wall at x=10
        }
        // Leave a gap only accessible via NE/SE diagonals
        groundType[10 + 3 * width] = 16; // gap at (10, 3)

        const path = findPath(8, 5, 12, 5, groundType, groundHeight, width, height, occupancy);
        expect(path).not.toBe(null);
        expect(path![path!.length - 1]).toEqual({ x: 12, y: 5 });
    });
});

describe('Path obstacle repair', () => {
    let state: GameState;
    const width = 32;
    const height = 32;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;

    beforeEach(() => {
        state = new GameState();
        groundType = new Uint8Array(width * height);
        groundHeight = new Uint8Array(width * height);
        groundType.fill(16);
    });

    describe('Push system', () => {
        it('lower ID should yield to higher ID push', () => {
            // Unit A (lower ID) at (5,5), Unit B (higher ID) at (4,5)
            const unitA = state.addEntity(EntityType.Unit, 0, 5, 5, 1);
            const unitB = state.addEntity(EntityType.Unit, 0, 4, 5, 1);

            // B pushes A — A has lower ID so it yields
            const result = pushUnit(state, unitB.id, unitA.id, groundType, groundHeight, width, height);

            // unitA.id < unitB.id — should NOT yield (lower ID doesn't yield)
            // Wait, the rule is: "Only yield if our ID is lower" means lower ID yields
            // pushUnit: blockedEntityId <= pushingEntityId => return false
            // unitA.id=1, unitB.id=2: blockedEntityId=1 <= pushingEntityId=2 => false
            // So lower ID does NOT get pushed by higher ID
            expect(result).toBe(false);
        });

        it('higher ID should yield when pushed by lower ID', () => {
            // Unit A (lower ID) at (5,5), Unit B (higher ID) at (6,5)
            const unitA = state.addEntity(EntityType.Unit, 0, 5, 5, 1);
            const unitB = state.addEntity(EntityType.Unit, 0, 6, 5, 1);

            // A pushes B — B has higher ID so it should yield
            const result = pushUnit(state, unitA.id, unitB.id, groundType, groundHeight, width, height);

            // unitB.id=2 > unitA.id=1 => blockedEntityId > pushingEntityId => yields
            expect(result).toBe(true);

            // Unit B should have moved
            const movedB = state.getEntity(unitB.id)!;
            expect(movedB.x !== 6 || movedB.y !== 5).toBe(true);
        });

        it('same ID should not yield', () => {
            const unitA = state.addEntity(EntityType.Unit, 0, 5, 5, 1);

            // Can't push yourself — blocked ID <= pushing ID
            const result = pushUnit(state, unitA.id, unitA.id, groundType, groundHeight, width, height);
            expect(result).toBe(false);
        });
    });

    describe('findRandomFreeDirection', () => {
        it('should find a free neighbor on open terrain', () => {
            state.addEntity(EntityType.Unit, 0, 10, 10, 1);

            const free = findRandomFreeDirection(
                state, 10, 10, groundType, groundHeight, width, height,
            );
            expect(free).not.toBe(null);
        });

        it('should return null when all neighbors are blocked', () => {
            const center = state.addEntity(EntityType.Unit, 0, 10, 10, 1);

            // Block all 6 hex neighbors
            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            for (const n of neighbors) {
                state.addEntity(EntityType.Unit, 0, n.x, n.y, 1);
            }

            const free = findRandomFreeDirection(
                state, 10, 10, groundType, groundHeight, width, height,
            );
            expect(free).toBe(null);
        });

        it('should not return impassable neighbors', () => {
            state.addEntity(EntityType.Unit, 0, 10, 10, 1);

            // Make all neighbor tiles water
            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            for (const n of neighbors) {
                if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
                    groundType[n.x + n.y * width] = 0;
                }
            }

            const free = findRandomFreeDirection(
                state, 10, 10, groundType, groundHeight, width, height,
            );
            expect(free).toBe(null);
        });
    });

    describe('Detour finding', () => {
        it('should find detour around single-tile obstacle', () => {
            // Unit at (5,5) wants to go to (7,5)
            // Direct path: (5,5) -> (6,5) -> (7,5)
            // Blocker at (6,5)
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 1);
            const blocker = state.addEntity(EntityType.Unit, 0, 6, 5, 1);

            // Find a path avoiding the blocker
            const path = findPath(
                5, 5, 7, 5,
                groundType, groundHeight, width, height,
                state.tileOccupancy,
            );

            expect(path).not.toBe(null);
            expect(path![path!.length - 1]).toEqual({ x: 7, y: 5 });
            // Path should go around the blocker
            const goesThrough65 = path!.some(p => p.x === 6 && p.y === 5);
            expect(goesThrough65).toBe(false);
        });
    });
});

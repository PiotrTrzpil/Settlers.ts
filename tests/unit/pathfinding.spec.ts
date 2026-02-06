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
    rotateDirection,
    hexDistance,
    getAllNeighbors,
} from '@/game/systems/hex-directions';
import { GameState } from '@/game/game-state';
import { pushUnit, findRandomFreeDirection, type TerrainAccessor } from '@/game/systems/movement/index';
import { createTestMap, TERRAIN, blockColumn, type TestMap } from './helpers/test-map';
import { createGameState, addUnit } from './helpers/test-game';

/** Helper to create TerrainAccessor from test map */
function makeTerrain(map: TestMap): TerrainAccessor {
    return {
        groundType: map.groundType,
        mapWidth: map.mapSize.width,
        mapHeight: map.mapSize.height,
    };
}

describe('Pathfinding (A*)', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should find a straight path on open terrain', () => {
        const path = findPath(5, 5, 10, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);

        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath).toHaveLength(5);
        expect(validPath[validPath.length - 1]).toEqual({ x: 10, y: 5 });
    });

    it('should return empty array when start equals goal', () => {
        const path = findPath(5, 5, 5, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath).toHaveLength(0);
    });

    it('should return null when goal is water', () => {
        map.groundType[20 + 5 * 64] = TERRAIN.WATER;
        const path = findPath(5, 5, 20, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).toBe(null);
    });

    it('should return null when path is completely blocked', () => {
        // Wall of water from y=0 to y=63 at x=15 and x=14
        blockColumn(map, 15);
        blockColumn(map, 14);
        const path = findPath(10, 5, 20, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).toBe(null);
    });

    it('should find path around obstacles', () => {
        // Wall with gap at y=10 — block both x=15 and x=14 columns
        for (let y = 0; y < 64; y++) {
            if (y !== 10) {
                map.groundType[15 + y * 64] = TERRAIN.WATER;
                map.groundType[14 + y * 64] = TERRAIN.WATER;
            }
        }

        const path = findPath(10, 5, 20, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath.length).toBeGreaterThan(5); // detour path
        expect(validPath[validPath.length - 1]).toEqual({ x: 20, y: 5 });
    });

    it('should not pass through rock tiles', () => {
        blockColumn(map, 15, TERRAIN.ROCK);
        blockColumn(map, 14, TERRAIN.ROCK);
        const path = findPath(10, 5, 20, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).toBe(null);
    });

    it('should consider height differences in cost', () => {
        for (let x = 5; x <= 15; x++) {
            map.groundHeight[x + 3 * 64] = 10;
        }

        const path = findPath(5, 5, 15, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath[validPath.length - 1]).toEqual({ x: 15, y: 5 });
    });

    it('should handle paths near map edges', () => {
        const path = findPath(0, 0, 5, 0, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        const validPath = path ?? [];
        expect(validPath[validPath.length - 1]).toEqual({ x: 5, y: 0 });
    });
});

describe('Hex Directions', () => {
    describe('getAllNeighbors', () => {
        it('should return correct 6 neighbors for (10, 10)', () => {
            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            expect(neighbors).toHaveLength(6);
            expect(neighbors).toEqual([
                { x: 11, y: 9 },   // NORTH_EAST
                { x: 11, y: 10 },  // EAST
                { x: 10, y: 11 },  // SOUTH_EAST
                { x: 9, y: 11 },   // SOUTH_WEST
                { x: 9, y: 10 },   // WEST
                { x: 10, y: 9 },   // NORTH_WEST
            ]);
        });

        it('should return correct neighbors for origin (0, 0)', () => {
            const neighbors = getAllNeighbors({ x: 0, y: 0 });
            expect(neighbors).toEqual([
                { x: 1, y: -1 },   // NORTH_EAST
                { x: 1, y: 0 },    // EAST
                { x: 0, y: 1 },    // SOUTH_EAST
                { x: -1, y: 1 },   // SOUTH_WEST
                { x: -1, y: 0 },   // WEST
                { x: 0, y: -1 },   // NORTH_WEST
            ]);
        });
    });

    describe('getNextHexPoint', () => {
        it('should move EAST correctly', () => {
            expect(getNextHexPoint({ x: 5, y: 5 }, EDirection.EAST)).toEqual({ x: 6, y: 5 });
        });

        it('should move WEST correctly', () => {
            expect(getNextHexPoint({ x: 5, y: 5 }, EDirection.WEST)).toEqual({ x: 4, y: 5 });
        });

        it('should move NORTH_EAST correctly', () => {
            expect(getNextHexPoint({ x: 5, y: 5 }, EDirection.NORTH_EAST)).toEqual({ x: 6, y: 4 });
        });

        it('should move SOUTH_WEST correctly', () => {
            expect(getNextHexPoint({ x: 5, y: 5 }, EDirection.SOUTH_WEST)).toEqual({ x: 4, y: 6 });
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
            expect(GRID_DELTA_X[EDirection.NORTH_EAST] + GRID_DELTA_X[EDirection.SOUTH_WEST]).toBe(0);
            expect(GRID_DELTA_Y[EDirection.NORTH_EAST] + GRID_DELTA_Y[EDirection.SOUTH_WEST]).toBe(0);
            expect(GRID_DELTA_X[EDirection.EAST] + GRID_DELTA_X[EDirection.WEST]).toBe(0);
            expect(GRID_DELTA_Y[EDirection.EAST] + GRID_DELTA_Y[EDirection.WEST]).toBe(0);
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
            expect(rotateDirection(EDirection.NORTH_EAST, 1)).toBe(EDirection.EAST);
            expect(rotateDirection(EDirection.EAST, 1)).toBe(EDirection.SOUTH_EAST);
            expect(rotateDirection(EDirection.NORTH_WEST, 1)).toBe(EDirection.NORTH_EAST);
        });

        it('should rotate counter-clockwise by 1', () => {
            expect(rotateDirection(EDirection.EAST, -1)).toBe(EDirection.NORTH_EAST);
            expect(rotateDirection(EDirection.NORTH_EAST, -1)).toBe(EDirection.NORTH_WEST);
        });

        it('should wrap around with offset 3 (opposite direction)', () => {
            expect(rotateDirection(EDirection.NORTH_EAST, 3)).toBe(EDirection.SOUTH_WEST);
            expect(rotateDirection(EDirection.EAST, 3)).toBe(EDirection.WEST);
            expect(rotateDirection(EDirection.SOUTH_EAST, 3)).toBe(EDirection.NORTH_WEST);
        });

        it('should return same direction with offset 0 or full circle (6)', () => {
            for (let d = 0; d < 6; d++) {
                expect(rotateDirection(d as EDirection, 0)).toBe(d);
                expect(rotateDirection(d as EDirection, 6)).toBe(d);
            }
        });
    });
});

describe('Hex Distance', () => {
    it('should return 0 for same point', () => {
        expect(hexDistance(5, 5, 5, 5)).toBe(0);
    });

    it('should return 1 for all 6 adjacent hex tiles', () => {
        const adjacent: [number, number][] = [
            [6, 5],  // EAST
            [6, 4],  // NORTH_EAST
            [5, 6],  // SOUTH_EAST
            [5, 4],  // NORTH_WEST
            [4, 6],  // SOUTH_WEST
            [4, 5],  // WEST
        ];
        for (const [x, y] of adjacent) {
            expect(hexDistance(5, 5, x, y)).toBeCloseTo(1, 3);
        }
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
        expect(hexDistance(0, 0, 2, 0)).toBeCloseTo(2, 4);
    });

    it('Y_SCALE should equal sqrt(3)/2 * 0.999999', () => {
        expect(Y_SCALE).toBeCloseTo(Math.sqrt(3) / 2 * 0.999999, 10);
    });
});

describe('Pathfinding with 6 directions', () => {
    let map: TestMap;

    beforeEach(() => {
        map = createTestMap();
    });

    it('should find paths using diagonal hex directions', () => {
        const path = findPath(5, 5, 6, 4, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        expect(path).toHaveLength(1);
        expect(path![0]).toEqual({ x: 6, y: 4 });
    });

    it('should use hex NE/SW diagonal when it is shorter', () => {
        const path = findPath(5, 5, 8, 2, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        expect(path!.length).toBe(3);
        expect(path![path!.length - 1]).toEqual({ x: 8, y: 2 });
    });

    it('should find path using SE direction', () => {
        const path = findPath(5, 5, 5, 8, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        expect(path!.length).toBe(3);
        expect(path![path!.length - 1]).toEqual({ x: 5, y: 8 });
    });

    it('should find path using NW direction', () => {
        const path = findPath(5, 5, 5, 2, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        expect(path!.length).toBe(3);
        expect(path![path!.length - 1]).toEqual({ x: 5, y: 2 });
    });

    it('bucket queue produces same path endpoint as expected', () => {
        const path = findPath(5, 5, 25, 20, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        expect(path![path!.length - 1]).toEqual({ x: 25, y: 20 });
    });

    it('should find path around obstacle using hex diagonals', () => {
        blockColumn(map, 10);
        map.groundType[10 + 3 * 64] = TERRAIN.GRASS; // gap at (10, 3)

        const path = findPath(8, 5, 12, 5, map.groundType, map.groundHeight, 64, 64, map.occupancy);
        expect(path).not.toBe(null);
        expect(path![path!.length - 1]).toEqual({ x: 12, y: 5 });
    });
});

describe('Path obstacle repair', () => {
    let state: GameState;
    let map: TestMap;

    beforeEach(() => {
        state = createGameState();
        map = createTestMap(64, 64);
    });

    describe('Push system', () => {
        it('lower ID does not yield when pushed by higher ID', () => {
            const { entity: unitA } = addUnit(state, 5, 5);
            const { entity: unitB } = addUnit(state, 4, 5);
            const controllerA = state.movement.getController(unitA.id)!;

            const result = pushUnit(
                unitB.id, controllerA, state.tileOccupancy, makeTerrain(map),
                (id, x, y) => state.updateEntityPosition(id, x, y)
            );
            expect(result).toBe(false);
        });

        it('higher ID should yield when pushed by lower ID', () => {
            const { entity: unitA } = addUnit(state, 5, 5);
            const { entity: unitB } = addUnit(state, 6, 5);
            const controllerB = state.movement.getController(unitB.id)!;

            const result = pushUnit(
                unitA.id, controllerB, state.tileOccupancy, makeTerrain(map),
                (id, x, y) => state.updateEntityPosition(id, x, y)
            );
            expect(result).toBe(true);

            const movedB = state.getEntity(unitB.id)!;
            expect(movedB.x !== 6 || movedB.y !== 5).toBe(true);
        });

        it('same ID should not yield', () => {
            const { entity: unitA } = addUnit(state, 5, 5);
            const controllerA = state.movement.getController(unitA.id)!;

            const result = pushUnit(
                unitA.id, controllerA, state.tileOccupancy, makeTerrain(map),
                (id, x, y) => state.updateEntityPosition(id, x, y)
            );
            expect(result).toBe(false);
        });
    });

    describe('findRandomFreeDirection', () => {
        it('should find a free neighbor on open terrain', () => {
            addUnit(state, 10, 10);

            const free = findRandomFreeDirection(10, 10, state.tileOccupancy, makeTerrain(map));
            expect(free).not.toBe(null);
        });

        it('should return null when all neighbors are blocked', () => {
            addUnit(state, 10, 10);

            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            for (const n of neighbors) {
                addUnit(state, n.x, n.y);
            }

            const free = findRandomFreeDirection(10, 10, state.tileOccupancy, makeTerrain(map));
            expect(free).toBe(null);
        });

        it('should not return impassable neighbors', () => {
            addUnit(state, 10, 10);

            const neighbors = getAllNeighbors({ x: 10, y: 10 });
            for (const n of neighbors) {
                if (n.x >= 0 && n.x < 64 && n.y >= 0 && n.y < 64) {
                    map.groundType[n.x + n.y * 64] = TERRAIN.WATER;
                }
            }

            const free = findRandomFreeDirection(10, 10, state.tileOccupancy, makeTerrain(map));
            expect(free).toBe(null);
        });
    });

    describe('Detour finding', () => {
        it('should find detour around single-tile obstacle', () => {
            addUnit(state, 5, 5);
            addUnit(state, 6, 5);

            const path = findPath(
                5, 5, 7, 5,
                map.groundType, map.groundHeight, 64, 64,
                state.tileOccupancy,
            );

            expect(path).not.toBe(null);
            expect(path![path!.length - 1]).toEqual({ x: 7, y: 5 });
            const goesThrough65 = path!.some(p => p.x === 6 && p.y === 5);
            expect(goesThrough65).toBe(false);
        });
    });
});

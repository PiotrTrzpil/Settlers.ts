/**
 * Tests for the push/collision resolution system.
 *
 * Verifies entity ID priority during collisions, goal preservation
 * after push, and free direction finding.
 */

import { describe, it, expect } from 'vitest';
import { createTestMap, type TestMap } from '../helpers/test-map';
import { createGameState, addUnit, addUnitWithPath } from '../helpers/test-game';
import { getAllNeighbors, hexDistance } from '@/game/systems/hex-directions';
import { pushUnit, findRandomFreeDirection, TerrainAccessor } from '@/game/systems/movement/index';
import { findPath } from '@/game/systems/pathfinding';

function makeTerrain(map: TestMap): TerrainAccessor {
    return {
        groundType: map.groundType,
        mapWidth: map.mapSize.width,
        mapHeight: map.mapSize.height,
    };
}

describe('Push & collision resolution', () => {
    it('resolves collisions by entity ID priority', () => {
        const map = createTestMap(64, 64);
        const state = createGameState();

        const { entity: unitA } = addUnit(state, 5, 5);
        const { entity: unitB } = addUnit(state, 6, 5);

        const controllerB = state.movement.getController(unitB.id)!;
        const controllerA = state.movement.getController(unitA.id)!;

        // Lower ID pushing higher ID -> higher yields
        const pushResult = pushUnit(
            unitA.id,
            controllerB,
            state.tileOccupancy,
            state.rng,
            makeTerrain(map),
            (id, x, y) => state.updateEntityPosition(id, x, y)
        );
        expect(pushResult).toBe(true);
        expect(unitB.x !== 6 || unitB.y !== 5).toBe(true);

        // Higher ID pushing lower ID -> lower does NOT yield
        const reverseResult = pushUnit(
            unitB.id,
            controllerA,
            state.tileOccupancy,
            state.rng,
            makeTerrain(map),
            (id, x, y) => state.updateEntityPosition(id, x, y)
        );
        expect(reverseResult).toBe(false);
    });

    it('pushed unit continues to its original goal', () => {
        const map = createTestMap(64, 64);
        const state = createGameState();
        state.movement.setTerrainData(map.groundType, map.groundHeight, map.mapSize.width, map.mapSize.height);

        // Unit A at (6,5) with a path to (15,5) - lower ID
        addUnitWithPath(
            state,
            6,
            5,
            [
                { x: 7, y: 5 },
                { x: 8, y: 5 },
                { x: 9, y: 5 },
                { x: 10, y: 5 },
                { x: 11, y: 5 },
                { x: 12, y: 5 },
                { x: 13, y: 5 },
                { x: 14, y: 5 },
                { x: 15, y: 5 },
            ],
            2
        );

        // Unit B at (5,5) - higher ID, will get pushed
        const { entity: unitB } = addUnitWithPath(
            state,
            5,
            5,
            [
                { x: 6, y: 5 },
                { x: 7, y: 5 },
            ],
            2
        );

        const controllerB = state.movement.getController(unitB.id)!;
        expect(controllerB.goal).toEqual({ x: 7, y: 5 });

        state.movement.update(0.5);

        const newPath = controllerB.path;
        if (newPath.length > 0) {
            expect(newPath[newPath.length - 1]).toEqual({ x: 7, y: 5 });
        }

        state.movement.update(10.0);
        expect(unitB.x).toBeGreaterThanOrEqual(6);
    });

    it('findRandomFreeDirection respects terrain and occupancy', () => {
        const map = createTestMap(64, 64);
        const state = createGameState();

        addUnit(state, 10, 10);

        const free = findRandomFreeDirection(10, 10, state.tileOccupancy, state.rng, makeTerrain(map));
        expect(free).not.toBeNull();

        // Block all 6 hex neighbors
        const neighbors = getAllNeighbors({ x: 10, y: 10 });
        for (const n of neighbors) {
            addUnit(state, n.x, n.y);
        }

        const blocked = findRandomFreeDirection(10, 10, state.tileOccupancy, state.rng, makeTerrain(map));
        expect(blocked).toBeNull();
    });

    it('hex neighbors, distance, and pathfinding agree on adjacency', () => {
        const neighbors = getAllNeighbors({ x: 10, y: 10 });
        expect(neighbors).toHaveLength(6);

        for (const n of neighbors) {
            const dist = hexDistance(10, 10, n.x, n.y);
            expect(dist).toBeCloseTo(1, 3);
        }

        const map = createTestMap();
        for (const n of neighbors) {
            if (n.x >= 0 && n.x < 64 && n.y >= 0 && n.y < 64) {
                const path = findPath(
                    10,
                    10,
                    n.x,
                    n.y,
                    map.groundType,
                    map.groundHeight,
                    64,
                    64,
                    map.occupancy,
                    map.buildingOccupancy
                );
                expect(path).not.toBeNull();
                expect(path).toHaveLength(1);
            }
        }
    });
});

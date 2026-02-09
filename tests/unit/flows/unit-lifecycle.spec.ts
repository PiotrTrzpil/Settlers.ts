/* eslint-disable max-lines-per-function */
/**
 * Integration test: Unit Lifecycle
 *
 * Sweeps across: Command System → GameState → Pathfinding →
 *                Movement → Push/Collision → HexDirections
 *
 * Tests the full lifecycle of a unit from spawning through movement,
 * pathfinding, collision resolution, and removal.
 */

import { describe, it, expect } from 'vitest';
import { createTestMap, TERRAIN, blockColumn, TestMap } from '../helpers/test-map';
import {
    createGameState,
    addUnit,
    addUnitWithPath,
    spawnUnit,
    moveUnit,
    removeEntity,
    placeBuilding,
} from '../helpers/test-game';
import { EntityType, BuildingType } from '@/game/entity';
import { findPath } from '@/game/systems/pathfinding';
import { getAllNeighbors, hexDistance } from '@/game/systems/hex-directions';
import { pushUnit, findRandomFreeDirection, TerrainAccessor } from '@/game/systems/movement/index';

/** Helper to create TerrainAccessor from test map */
function makeTerrain(map: TestMap): TerrainAccessor {
    return {
        groundType: map.groundType,
        mapWidth: map.mapSize.width,
        mapHeight: map.mapSize.height,
    };
}

describe('Unit Lifecycle: spawn → pathfind → move → interact', () => {
    it('full lifecycle from spawn through movement to arrival', () => {
        const map = createTestMap();
        const state = createGameState();

        // ── Step 1: Spawn a unit via command ──
        const spawned = spawnUnit(state, map, 5, 5);
        expect(spawned).toBe(true);
        expect(state.entities).toHaveLength(1);

        const unit = state.entities[0];
        expect(unit.type).toBe(EntityType.Unit);
        expect(unit.x).toBe(5);
        expect(unit.y).toBe(5);

        // UnitState created with correct defaults
        const unitState = state.unitStates.get(unit.id);
        expect(unitState).toBeDefined();
        expect(unitState!.path).toHaveLength(0);
        expect(unitState!.speed).toBe(2);
        expect(unitState!.prevX).toBe(5);
        expect(unitState!.prevY).toBe(5);

        // ── Step 2: Command the unit to move via pathfinding ──
        const moved = moveUnit(state, map, unit.id, 10, 5);
        expect(moved).toBe(true);
        expect(unitState!.path.length).toBeGreaterThan(0);
        expect(unitState!.path[unitState!.path.length - 1]).toEqual({ x: 10, y: 5 });

        // ── Step 3: Simulate movement updates ──
        // Progress starts at 1 when path is set (for immediate responsiveness).
        // At speed 2, 0.5s adds 1 to progress -> total 2 -> moves 2 tiles.
        state.movement.update(0.5);
        expect(unit.x).toBe(7);
        expect(unit.y).toBe(5);
        expect(unitState!.prevX).toBe(6); // Previous position tracked for interpolation

        // Continue movement to completion
        state.movement.update(5.0); // Enough time to finish
        expect(unit.x).toBe(10);
        expect(unit.y).toBe(5);
        expect(unitState!.path).toHaveLength(0);
        expect(unitState!.moveProgress).toBe(0);

        // ── Step 4: Tile occupancy updated correctly ──
        expect(state.getEntityAt(10, 5)).toBeDefined();
        expect(state.getEntityAt(10, 5)!.id).toBe(unit.id);
        expect(state.getEntityAt(5, 5)).toBeUndefined(); // Old position cleared

        // ── Step 5: Remove unit ──
        const removed = removeEntity(state, map, unit.id);
        expect(removed).toBe(true);
        expect(state.entities).toHaveLength(0);
        expect(state.unitStates.has(unit.id)).toBe(false);
        expect(state.getEntityAt(10, 5)).toBeUndefined();
    });

    it('pathfinding finds routes around obstacles using hex directions', () => {
        const map = createTestMap();

        // Create a water wall with a gap accessible via hex diagonals
        blockColumn(map, 10);
        map.groundType[10 + 3 * map.mapSize.width] = TERRAIN.GRASS; // gap at (10, 3)

        const path = findPath(
            8, 5, 12, 5,
            map.groundType, map.groundHeight,
            map.mapSize.width, map.mapSize.height,
            map.occupancy,
        );

        expect(path).not.toBeNull();
        expect(path![path!.length - 1]).toEqual({ x: 12, y: 5 });

        // Path must go through the gap
        const usesGap = path!.some(p => p.x === 10 && p.y === 3);
        expect(usesGap).toBe(true);
    });

    it('multiple units move independently and respect occupancy', () => {
        createTestMap(); // Needed for test setup
        const state = createGameState();

        const { entity: u1 } = addUnitWithPath(state, 0, 0, [{ x: 1, y: 0 }], 2);
        const { entity: u2 } = addUnitWithPath(state, 10, 10, [{ x: 11, y: 10 }, { x: 12, y: 10 }], 4);

        state.movement.update(0.5);

        // u1: speed 2 * 0.5s = 1 tile
        expect(u1.x).toBe(1);
        // u2: speed 4 * 0.5s = 2 tiles
        expect(u2.x).toBe(12);

        // Both have updated occupancy
        expect(state.getEntityAt(1, 0)!.id).toBe(u1.id);
        expect(state.getEntityAt(12, 10)!.id).toBe(u2.id);
        expect(state.getEntityAt(0, 0)).toBeUndefined();
        expect(state.getEntityAt(10, 10)).toBeUndefined();
    });

    it('push system resolves collisions by entity ID priority', () => {
        const map = createTestMap(64, 64);
        const state = createGameState();

        // Unit A (lower ID=1) at (5,5), Unit B (higher ID=2) at (6,5)
        const { entity: unitA } = addUnit(state, 5, 5);
        const { entity: unitB } = addUnit(state, 6, 5);

        const controllerB = state.movement.getController(unitB.id)!;
        const controllerA = state.movement.getController(unitA.id)!;

        // Lower ID pushing higher ID → higher yields
        const pushResult = pushUnit(
            unitA.id,
            controllerB,
            state.tileOccupancy,
            makeTerrain(map),
            (id, x, y) => state.updateEntityPosition(id, x, y),
        );
        expect(pushResult).toBe(true);
        // Unit B should have moved away from (6,5)
        expect(unitB.x !== 6 || unitB.y !== 5).toBe(true);

        // Higher ID pushing lower ID → lower does NOT yield
        const reverseResult = pushUnit(
            unitB.id,
            controllerA,
            state.tileOccupancy,
            makeTerrain(map),
            (id, x, y) => state.updateEntityPosition(id, x, y),
        );
        expect(reverseResult).toBe(false);
    });

    it('unit spawned adjacent to building when target tile is occupied', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // Place a warehouse (no auto-spawn) to occupy tile
        placeBuilding(state, map, 10, 10, BuildingType.StorageArea);
        expect(state.entities).toHaveLength(1);
        expect(state.getEntityAt(10, 10)).toBeDefined();

        // Spawn unit at same tile → should be placed adjacent
        const spawned = spawnUnit(state, map, 10, 10);
        expect(spawned).toBe(true);

        const unit = state.entities.find(e => e.type === EntityType.Unit);
        expect(unit).toBeDefined();
        // Should be adjacent, not at the same spot
        const dist = Math.abs(unit!.x - 10) + Math.abs(unit!.y - 10);
        expect(dist).toBe(1);
    });

    it('pathfinding returns null when target is unreachable', () => {
        const map = createTestMap();

        // Create impenetrable double wall
        blockColumn(map, 14);
        blockColumn(map, 15);

        const path = findPath(
            10, 5, 20, 5,
            map.groundType, map.groundHeight,
            map.mapSize.width, map.mapSize.height,
            map.occupancy,
        );

        expect(path).toBeNull();
    });

    it('hex neighbors, distance, and pathfinding agree on adjacency', () => {
        // Test that neighbors from hex directions are exactly distance 1
        const neighbors = getAllNeighbors({ x: 10, y: 10 });
        expect(neighbors).toHaveLength(6);

        for (const n of neighbors) {
            const dist = hexDistance(10, 10, n.x, n.y);
            expect(dist).toBeCloseTo(1, 3);
        }

        // Single-step pathfinding to each neighbor should find path of length 1
        const map = createTestMap();
        for (const n of neighbors) {
            if (n.x >= 0 && n.x < 64 && n.y >= 0 && n.y < 64) {
                const path = findPath(
                    10, 10, n.x, n.y,
                    map.groundType, map.groundHeight,
                    64, 64, map.occupancy,
                );
                expect(path).not.toBeNull();
                expect(path).toHaveLength(1);
            }
        }
    });

    it('findRandomFreeDirection respects terrain and occupancy', () => {
        const map = createTestMap(64, 64);
        const state = createGameState();

        addUnit(state, 10, 10);

        // All open → should find a free direction
        const free = findRandomFreeDirection(
            10, 10,
            state.tileOccupancy,
            makeTerrain(map),
        );
        expect(free).not.toBeNull();

        // Block all 6 hex neighbors with units
        const neighbors = getAllNeighbors({ x: 10, y: 10 });
        for (const n of neighbors) {
            addUnit(state, n.x, n.y);
        }

        const blocked = findRandomFreeDirection(
            10, 10,
            state.tileOccupancy,
            makeTerrain(map),
        );
        expect(blocked).toBeNull();
    });

    it('movement updates smooth interpolation tracking', () => {
        const state = createGameState();
        // Longer path to test incremental movement
        const { entity, unitState } = addUnitWithPath(
            state, 5, 5,
            [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }],
            2,
        );

        // Initial prevX/prevY = spawn position
        expect(unitState.prevX).toBe(5);
        expect(unitState.prevY).toBe(5);

        // Progress starts at 1 when path set. At speed 2, 0.5s adds 1 -> moves 2 tiles.
        state.movement.update(0.5);
        expect(entity.x).toBe(7);
        expect(unitState.prevX).toBe(6); // Tracks previous tile during movement
        expect(unitState.prevY).toBe(5);

        // Continue movement: 0.5s adds 1 -> moves 1 tile (progress was 0, now 1)
        state.movement.update(0.5);
        expect(entity.x).toBe(8);
        expect(unitState.prevX).toBe(7);

        // Complete path: 0.5s adds 1 -> moves 1 tile
        state.movement.update(0.5);
        expect(entity.x).toBe(9);
        // prev tracks the tile before current (used for interpolation)
        expect(unitState.prevX).toBe(8);
        expect(unitState.prevY).toBe(5);
    });
});

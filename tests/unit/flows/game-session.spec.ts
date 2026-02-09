/**
 * Integration test: Game Session Flow
 *
 * Sweeps across all major subsystems in a single session-like flow:
 *   GameState → Commands → Placement → Economy →
 *   Pathfinding → Movement → Selection → Construction → Removal
 *
 * Mimics what happens during an actual game: player places buildings,
 * spawns units, selects entities, and moves units around.
 */

import { describe, it, expect } from 'vitest';
import { createTestMap, TERRAIN, setTerrainAt } from '../helpers/test-map';
import {
    createGameState,
    placeBuilding,
    spawnUnit,
    moveUnit,
    selectEntity,
    removeEntity,
} from '../helpers/test-game';
import { EntityType, BuildingType } from '@/game/entity';
// Movement is handled via state.movement.update(dt)
import { executeCommand } from '@/game/commands';
import { EventBus } from '@/game/event-bus';
import {
    BUILDING_PRODUCTIONS,
    CONSTRUCTION_COSTS,
    getBuildingTypesRequestingMaterial,
    EMaterialType,
    isMaterialDroppable,
    getMaterialPriority,
} from '@/game/economy';
import { isPassable, isBuildable, canPlaceBuilding } from '@/game/features/placement';
import { findPath } from '@/game/systems/pathfinding';

describe('Game Session: multi-system integration sweep', () => {
    it('player builds an economy: lumberjack → sawmill → supply chain validation', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // ── Place a Lumberjack (produces TRUNK) ──
        expect(placeBuilding(state, map, 20, 20, BuildingType.Lumberjack, 0)).toBe(true);

        // Lumberjack auto-spawns a worker
        const lumberjackEntities = state.entities.filter(e => e.type === EntityType.Building && e.subType === BuildingType.Lumberjack);
        expect(lumberjackEntities).toHaveLength(1);
        const workers = state.entities.filter(e => e.type === EntityType.Unit);
        expect(workers).toHaveLength(1);

        // ── Verify production chain data ──
        const lumberjackChain = BUILDING_PRODUCTIONS.get(BuildingType.Lumberjack)!;
        expect(lumberjackChain.output).toBe(EMaterialType.TRUNK);
        expect(lumberjackChain.inputs).toHaveLength(0); // No inputs needed

        // ── Place a Sawmill (consumes TRUNK, produces PLANK) ──
        expect(placeBuilding(state, map, 25, 20, BuildingType.Sawmill, 0)).toBe(true);

        const sawmillChain = BUILDING_PRODUCTIONS.get(BuildingType.Sawmill)!;
        expect(sawmillChain.output).toBe(EMaterialType.PLANK);
        expect(sawmillChain.inputs).toContain(EMaterialType.TRUNK);

        // ── Verify TRUNK is consumed by Sawmill ──
        const trunkConsumers = getBuildingTypesRequestingMaterial(EMaterialType.TRUNK);
        expect(trunkConsumers).toContain(BuildingType.Sawmill);

        // ── Verify construction costs use standard materials ──
        const lumberjackCost = CONSTRUCTION_COSTS.get(BuildingType.Lumberjack)!;
        expect(lumberjackCost.length).toBeGreaterThan(0);
        for (const cost of lumberjackCost) {
            expect(isMaterialDroppable(cost.material)).toBe(true);
            expect(cost.count).toBeGreaterThan(0);
        }

        // ── Verify material priority ordering ──
        expect(getMaterialPriority(EMaterialType.PLANK)).toBe(0);
        expect(getMaterialPriority(EMaterialType.STONE)).toBe(1);
        expect(getMaterialPriority(EMaterialType.NO_MATERIAL)).toBe(-1);
    });

    it('full session: build, select, move units, manage entities', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // ── Build phase: place multiple buildings ──
        expect(placeBuilding(state, map, 10, 10, BuildingType.Warehouse, 0)).toBe(true);
        expect(placeBuilding(state, map, 20, 20, BuildingType.Lumberjack, 0)).toBe(true);
        expect(placeBuilding(state, map, 30, 30, BuildingType.Tower, 1)).toBe(true);

        // Warehouse (no auto-spawn) + Lumberjack (auto-spawn worker) + Tower (no auto-spawn)
        const buildings = state.entities.filter(e => e.type === EntityType.Building);
        expect(buildings).toHaveLength(3);
        const units = state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBeGreaterThanOrEqual(1);

        // ── Spawn additional units ──
        expect(spawnUnit(state, map, 15, 15, 1, 0)).toBe(true); // Builder (selectable)
        const spawnedUnit = state.entities.find(
            e => e.type === EntityType.Unit && e.x === 15 && e.y === 15
        );
        expect(spawnedUnit).toBeDefined();

        // ── Selection flow ──
        selectEntity(state, map, spawnedUnit!.id);
        expect(state.selectedEntityId).toBe(spawnedUnit!.id);
        expect(state.selectedEntityIds.has(spawnedUnit!.id)).toBe(true);

        // Deselect
        selectEntity(state, map, null);
        expect(state.selectedEntityId).toBeNull();
        expect(state.selectedEntityIds.size).toBe(0);

        // ── Area selection ──
        executeCommand(
            state,
            { type: 'select_area', x1: 14, y1: 14, x2: 16, y2: 16 },
            map.groundType, map.groundHeight, map.mapSize, new EventBus(),
        );
        // Should select the unit at (15,15), prefer units over buildings
        expect(state.selectedEntityIds.size).toBeGreaterThanOrEqual(1);
        const selectedId = Array.from(state.selectedEntityIds)[0];
        const selected = state.getEntity(selectedId);
        expect(selected?.type).toBe(EntityType.Unit);

        // ── Move the selected unit ──
        expect(moveUnit(state, map, spawnedUnit!.id, 18, 15)).toBe(true);
        const unitState = state.unitStates.get(spawnedUnit!.id);
        expect(unitState!.path.length).toBeGreaterThan(0);

        // Simulate movement
        state.movement.update(5.0); // Enough time to arrive
        expect(spawnedUnit!.x).toBe(18);
        expect(spawnedUnit!.y).toBe(15);

        // ── Remove entities ──
        const totalBefore = state.entities.length;
        removeEntity(state, map, spawnedUnit!.id);
        expect(state.entities.length).toBe(totalBefore - 1);
        expect(state.unitStates.has(spawnedUnit!.id)).toBe(false);
    });

    it('terrain validation is consistent across placement, indicator, and pathfinding', () => {
        const map = createTestMap();

        // Test terrain types for consistency across systems
        const terrainTypes = [
            { type: TERRAIN.WATER, passable: false, buildable: false },
            { type: TERRAIN.GRASS, passable: true, buildable: true },
            { type: TERRAIN.ROCK, passable: false, buildable: false },
            { type: TERRAIN.BEACH, passable: true, buildable: false },
            { type: TERRAIN.DESERT, passable: true, buildable: true },
            { type: TERRAIN.SWAMP, passable: true, buildable: false },
            { type: TERRAIN.SNOW, passable: true, buildable: false },
        ];

        for (const { type, passable, buildable } of terrainTypes) {
            // Placement system functions
            expect(isPassable(type)).toBe(passable);
            expect(isBuildable(type)).toBe(buildable);

            // Placement via command should agree
            if (buildable) {
                const fresh = createTestMap();
                setTerrainAt(fresh, 20, 20, type);
                const buildResult = canPlaceBuilding(
                    fresh.groundType, fresh.groundHeight, fresh.mapSize, fresh.occupancy, 20, 20,
                );
                expect(buildResult).toBe(true);
            }

            // Pathfinding should agree on passability
            if (!passable) {
                // Set goal to this terrain type → pathfinding should fail
                const pathMap = createTestMap();
                setTerrainAt(pathMap, 20, 5, type);
                const path = findPath(
                    5, 5, 20, 5,
                    pathMap.groundType, pathMap.groundHeight,
                    64, 64, pathMap.occupancy,
                );
                expect(path).toBeNull();
            }
        }
    });

    it('selection prefers units over buildings in mixed area', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // Place a building and a unit in the same area
        placeBuilding(state, map, 10, 10, BuildingType.Warehouse, 0);
        spawnUnit(state, map, 11, 10, 1, 0); // Builder (selectable)

        // Area select covering both
        executeCommand(
            state,
            { type: 'select_area', x1: 9, y1: 9, x2: 12, y2: 11 },
            map.groundType, map.groundHeight, map.mapSize, new EventBus(),
        );

        // Should prefer units
        expect(state.selectedEntityIds.size).toBe(1);
        const selectedId = Array.from(state.selectedEntityIds)[0];
        const selected = state.getEntity(selectedId);
        expect(selected?.type).toBe(EntityType.Unit);

        // Empty area clears selection
        executeCommand(
            state,
            { type: 'select_area', x1: 50, y1: 50, x2: 60, y2: 60 },
            map.groundType, map.groundHeight, map.mapSize, new EventBus(),
        );
        expect(state.selectedEntityIds.size).toBe(0);
        expect(state.selectedEntityId).toBeNull();
    });

    it('entity radius query finds nearby entities across types', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // Create a cluster of entities
        placeBuilding(state, map, 20, 20, BuildingType.Warehouse, 0);
        spawnUnit(state, map, 21, 20, 0, 0);
        spawnUnit(state, map, 22, 20, 0, 0);
        // Far-away entity
        spawnUnit(state, map, 50, 50, 0, 0);

        const nearby = state.getEntitiesInRadius(20, 20, 3);
        // Should find warehouse + 2 nearby units, but not the far unit
        expect(nearby.length).toBeGreaterThanOrEqual(3);
        expect(nearby.every(e => !(e.x === 50 && e.y === 50))).toBe(true);
    });
});

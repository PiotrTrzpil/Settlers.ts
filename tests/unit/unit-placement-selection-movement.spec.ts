import { describe, it, expect, beforeEach } from 'vitest';
import { GameState } from '@/game/game-state';
import { EntityType, UnitType } from '@/game/entity';
import { executeCommand } from '@/game/commands/command';
import { MapSize } from '@/utilities/map-size';

/**
 * Comprehensive tests for the unit placement, selection, and movement systems.
 * Tests cover: spawn_unit, select_at_tile, toggle_selection, move_selected_units,
 * multi-select, shift+click, formation movement, and full integration flows.
 */
describe('Unit Placement, Selection & Movement', () => {
    let state: GameState;
    let mapSize: MapSize;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;

    beforeEach(() => {
        state = new GameState();
        mapSize = new MapSize(64, 64);
        groundType = new Uint8Array(64 * 64);
        groundHeight = new Uint8Array(64 * 64);
        groundType.fill(16); // all grass (passable & buildable)
        // Set terrain data for the movement system (required for pathfinding)
        state.setTerrainData(groundType, groundHeight, mapSize.width, mapSize.height);
    });

    // ── Unit Placement (spawn_unit) ────────────────────────────────────

    describe('Unit Placement (spawn_unit)', () => {
        it('should spawn a bearer at the given position', () => {
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 10,
                y: 10,
                player: 0,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.entities).toHaveLength(1);
            expect(state.entities[0].type).toBe(EntityType.Unit);
            expect(state.entities[0].subType).toBe(UnitType.Bearer);
            expect(state.entities[0].x).toBe(10);
            expect(state.entities[0].y).toBe(10);
        });

        it('should spawn a swordsman at the given position', () => {
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Swordsman,
                x: 20,
                y: 20,
                player: 0,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.entities[0].subType).toBe(UnitType.Swordsman);
        });

        it('should create unit state with default speed', () => {
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 10,
                y: 10,
                player: 0,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            const unitState = state.unitStates.get(state.entities[0].id);
            expect(unitState).toBeDefined();
            expect(unitState!.speed).toBe(2);
            expect(unitState!.path).toHaveLength(0);
            expect(unitState!.prevX).toBe(10);
            expect(unitState!.prevY).toBe(10);
        });

        it('should spawn adjacent when target tile is occupied', () => {
            // Place first unit
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 10,
                y: 10,
                player: 0,
            }, groundType, groundHeight, mapSize);

            // Spawn second unit at same location
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Swordsman,
                x: 10,
                y: 10,
                player: 0,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.entities).toHaveLength(2);
            // Second unit should not be at (10,10) since it's occupied
            const swordsman = state.entities.find(e => e.subType === UnitType.Swordsman)!;
            expect(swordsman.x !== 10 || swordsman.y !== 10).toBe(true);
        });

        it('should fail when spawning on water with no adjacent passable tile', () => {
            // Make a small island of water
            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 3; x++) {
                    groundType[mapSize.toIndex(x, y)] = 0; // water
                }
            }

            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 1,
                y: 1,
                player: 0,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
        });

        it('should register tile occupancy for spawned unit', () => {
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 15,
                y: 15,
                player: 0,
            }, groundType, groundHeight, mapSize);

            expect(state.getEntityAt(15, 15)).toBeDefined();
            expect(state.getEntityAt(15, 15)!.type).toBe(EntityType.Unit);
        });

        it('should spawn units for different players', () => {
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 10,
                y: 10,
                player: 0,
            }, groundType, groundHeight, mapSize);

            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Bearer,
                x: 20,
                y: 20,
                player: 1,
            }, groundType, groundHeight, mapSize);

            expect(state.entities[0].player).toBe(0);
            expect(state.entities[1].player).toBe(1);
        });

        it('should spawn all unit types', () => {
            const types = [UnitType.Bearer, UnitType.Builder, UnitType.Swordsman, UnitType.Bowman, UnitType.Pikeman, UnitType.Priest];
            for (let i = 0; i < types.length; i++) {
                const result = executeCommand(state, {
                    type: 'spawn_unit',
                    unitType: types[i],
                    x: 10 + i * 2,
                    y: 10,
                    player: 0,
                }, groundType, groundHeight, mapSize);
                expect(result).toBe(true);
            }
            expect(state.entities).toHaveLength(types.length);
        });
    });

    // ── Selection (select_at_tile) ─────────────────────────────────────

    describe('Selection (select_at_tile)', () => {
        it('should select a unit at a tile', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);

            const result = executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.selectedEntityId).toBe(unit.id);
            expect(state.selectedEntityIds.has(unit.id)).toBe(true);
            expect(state.selectedEntityIds.size).toBe(1);
        });

        it('should deselect when clicking empty tile', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            state.selectedEntityId = unit.id;
            state.selectedEntityIds.add(unit.id);

            const result = executeCommand(state, {
                type: 'select_at_tile',
                x: 20,
                y: 20,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.selectedEntityId).toBe(null);
            expect(state.selectedEntityIds.size).toBe(0);
        });

        it('should replace selection on normal click', () => {
            const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 20, 20, 0);

            // Select unit1
            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(unit1.id);

            // Click unit2 without shift
            executeCommand(state, {
                type: 'select_at_tile',
                x: 20,
                y: 20,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(unit2.id);
            expect(state.selectedEntityIds.size).toBe(1);
            expect(state.selectedEntityIds.has(unit2.id)).toBe(true);
            expect(state.selectedEntityIds.has(unit1.id)).toBe(false);
        });

        it('should add to selection with shift+click', () => {
            const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 20, 20, 0);

            // Select unit1
            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            // Shift+click unit2
            executeCommand(state, {
                type: 'select_at_tile',
                x: 20,
                y: 20,
                addToSelection: true,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(2);
            expect(state.selectedEntityIds.has(unit1.id)).toBe(true);
            expect(state.selectedEntityIds.has(unit2.id)).toBe(true);
        });

        it('should toggle entity off with shift+click on already-selected', () => {
            const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 20, 20, 0);

            // Select both
            state.selectedEntityIds.add(unit1.id);
            state.selectedEntityIds.add(unit2.id);
            state.selectedEntityId = unit1.id;

            // Shift+click unit1 (toggle it off)
            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: true,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(1);
            expect(state.selectedEntityIds.has(unit1.id)).toBe(false);
            expect(state.selectedEntityIds.has(unit2.id)).toBe(true);
        });

        it('should update primary selection when toggling off primary', () => {
            const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 20, 20, 0);

            state.selectedEntityIds.add(unit1.id);
            state.selectedEntityIds.add(unit2.id);
            state.selectedEntityId = unit1.id;

            // Shift+click to deselect the primary entity
            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: true,
            }, groundType, groundHeight, mapSize);

            // Primary should switch to remaining entity
            expect(state.selectedEntityId).toBe(unit2.id);
        });

        it('should select building at tile', () => {
            const building = state.addEntity(EntityType.Building, 1, 10, 10, 0);

            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(building.id);
        });
    });

    // ── Toggle Selection ───────────────────────────────────────────────

    describe('Toggle Selection', () => {
        it('should add entity to selection', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);

            const result = executeCommand(state, {
                type: 'toggle_selection',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.selectedEntityIds.has(unit.id)).toBe(true);
        });

        it('should remove entity from selection', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            const result = executeCommand(state, {
                type: 'toggle_selection',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.selectedEntityIds.has(unit.id)).toBe(false);
            expect(state.selectedEntityId).toBe(null);
        });

        it('should fail for non-existent entity', () => {
            const result = executeCommand(state, {
                type: 'toggle_selection',
                entityId: 999,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
        });

        it('should set primary selection when adding first entity', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);

            executeCommand(state, {
                type: 'toggle_selection',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(unit.id);
        });

        it('should maintain primary when adding second entity', () => {
            const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 20, 20, 0);

            state.selectedEntityIds.add(unit1.id);
            state.selectedEntityId = unit1.id;

            executeCommand(state, {
                type: 'toggle_selection',
                entityId: unit2.id,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(unit1.id); // Primary unchanged
            expect(state.selectedEntityIds.size).toBe(2);
        });
    });

    // ── Move Selected Units ────────────────────────────────────────────

    describe('Move Selected Units (move_selected_units)', () => {
        it('should move a single selected unit to target', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            const result = executeCommand(state, {
                type: 'move_selected_units',
                targetX: 10,
                targetY: 5,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            const unitState = state.unitStates.get(unit.id);
            expect(unitState).toBeDefined();
            expect(unitState!.path.length).toBeGreaterThan(0);
        });

        it('should move multiple selected units with formation', () => {
            const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 7, 0);
            state.selectedEntityIds.add(unit1.id);
            state.selectedEntityIds.add(unit2.id);
            state.selectedEntityId = unit1.id;

            const result = executeCommand(state, {
                type: 'move_selected_units',
                targetX: 20,
                targetY: 20,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            const us1 = state.unitStates.get(unit1.id);
            const us2 = state.unitStates.get(unit2.id);
            expect(us1!.path.length).toBeGreaterThan(0);
            expect(us2!.path.length).toBeGreaterThan(0);

            // Units should have different targets (formation offsets)
            const target1 = us1!.path[us1!.path.length - 1];
            const target2 = us2!.path[us2!.path.length - 1];
            expect(target1.x !== target2.x || target1.y !== target2.y).toBe(true);
        });

        it('should ignore non-unit entities in selection', () => {
            const building = state.addEntity(EntityType.Building, 1, 10, 10, 0);
            state.selectedEntityIds.add(building.id);
            state.selectedEntityId = building.id;

            const result = executeCommand(state, {
                type: 'move_selected_units',
                targetX: 20,
                targetY: 20,
            }, groundType, groundHeight, mapSize);

            // No units to move
            expect(result).toBe(false);
        });

        it('should fail with empty selection', () => {
            const result = executeCommand(state, {
                type: 'move_selected_units',
                targetX: 20,
                targetY: 20,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
        });

        it('should move only units when selection includes buildings', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            const building = state.addEntity(EntityType.Building, 1, 10, 10, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityIds.add(building.id);
            state.selectedEntityId = unit.id;

            const result = executeCommand(state, {
                type: 'move_selected_units',
                targetX: 20,
                targetY: 20,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            const unitState = state.unitStates.get(unit.id);
            expect(unitState!.path.length).toBeGreaterThan(0);
        });
    });

    // ── Unit Movement (integration) ────────────────────────────────────

    describe('Unit Movement Integration', () => {
        it('should move unit along path over multiple ticks', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'move_selected_units',
                targetX: 10,
                targetY: 5,
            }, groundType, groundHeight, mapSize);

            const unitState = state.unitStates.get(unit.id)!;
            const pathLength = unitState.path.length;
            expect(pathLength).toBeGreaterThan(0);

            // Simulate movement ticks
            for (let i = 0; i < 100; i++) {
                state.movement.update(1 / 30);
            }

            // Unit should have reached or approached the target
            expect(unit.x).toBe(10);
            expect(unit.y).toBe(5);
            expect(unitState.path).toHaveLength(0); // Path completed
        });

        it('should update tile occupancy during movement', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 5, 5, 0);
            const controller = state.movement.getController(unit.id)!;
            controller.startPath([{ x: 6, y: 5 }, { x: 7, y: 5 }]);
            // Default speed is 2 for Bearer

            // Move one tile
            state.movement.update(0.5);

            expect(state.getEntityAt(5, 5)).toBeUndefined();
            expect(state.getEntityAt(6, 5)).toBeDefined();
            expect(state.getEntityAt(6, 5)!.id).toBe(unit.id);
        });

        it('should track previous position for interpolation', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 5, 5, 0);
            const controller = state.movement.getController(unit.id)!;
            const unitState = state.unitStates.get(unit.id)!;
            controller.startPath([{ x: 6, y: 5 }, { x: 7, y: 5 }]);
            // Default speed is 2 for Bearer

            // Move one tile (0.5s at speed 2 = 1 tile)
            state.movement.update(0.5);

            expect(unit.x).toBe(6);
            expect(unitState.prevX).toBe(5);
            expect(unitState.prevY).toBe(5);
        });

        it('should reset state after path completion', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 5, 5, 0);
            const controller = state.movement.getController(unit.id)!;
            const unitState = state.unitStates.get(unit.id)!;
            controller.startPath([{ x: 6, y: 5 }]);
            controller.setSpeed(10);

            state.movement.update(1.0);

            expect(unitState.path).toHaveLength(0);
            expect(unitState.pathIndex).toBe(0);
            expect(unitState.moveProgress).toBe(0);
            expect(unitState.prevX).toBe(unit.x);
            expect(unitState.prevY).toBe(unit.y);
        });
    });

    // ── Full Integration Flows ─────────────────────────────────────────

    describe('Full Integration: Spawn → Select → Move', () => {
        it('should spawn, select, and move a unit end-to-end', () => {
            // Spawn
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Swordsman,
                x: 5,
                y: 5,
                player: 0,
            }, groundType, groundHeight, mapSize);

            const unit = state.entities[0];
            expect(unit).toBeDefined();

            // Select at tile
            executeCommand(state, {
                type: 'select_at_tile',
                x: 5,
                y: 5,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(unit.id);

            // Move
            executeCommand(state, {
                type: 'move_selected_units',
                targetX: 15,
                targetY: 5,
            }, groundType, groundHeight, mapSize);

            const unitState = state.unitStates.get(unit.id)!;
            expect(unitState.path.length).toBeGreaterThan(0);

            // Simulate movement
            for (let i = 0; i < 200; i++) {
                state.movement.update(1 / 30);
            }

            expect(unit.x).toBe(15);
            expect(unit.y).toBe(5);
        });

        it('should handle multi-unit workflow: spawn multiple, box select, move in formation', () => {
            // Spawn 3 units in a cluster
            for (let i = 0; i < 3; i++) {
                executeCommand(state, {
                    type: 'spawn_unit',
                    unitType: UnitType.Swordsman,
                    x: 5 + i,
                    y: 5,
                    player: 0,
                }, groundType, groundHeight, mapSize);
            }
            expect(state.entities).toHaveLength(3);

            // Box select all 3
            executeCommand(state, {
                type: 'select_area',
                x1: 4,
                y1: 4,
                x2: 8,
                y2: 6,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(3);

            // Move all in formation to a nearby target (short distance)
            executeCommand(state, {
                type: 'move_selected_units',
                targetX: 15,
                targetY: 10,
            }, groundType, groundHeight, mapSize);

            // All should have paths
            for (const entity of state.entities) {
                const us = state.unitStates.get(entity.id)!;
                expect(us.path.length).toBeGreaterThan(0);
            }

            // Record starting positions
            const startPositions = state.entities.map(e => ({ x: e.x, y: e.y }));

            // Simulate enough movement ticks
            for (let i = 0; i < 600; i++) {
                state.movement.update(1 / 30);
            }

            // All units should have moved from their start positions
            for (let i = 0; i < state.entities.length; i++) {
                const entity = state.entities[i];
                const start = startPositions[i];
                const moved = entity.x !== start.x || entity.y !== start.y;
                expect(moved).toBe(true);
            }

            // All units should be near the target (within formation spread + tolerance)
            for (const entity of state.entities) {
                expect(Math.abs(entity.x - 15)).toBeLessThanOrEqual(4);
                expect(Math.abs(entity.y - 10)).toBeLessThanOrEqual(4);
            }
        });

        it('should handle spawn → shift select multiple → move', () => {
            // Spawn 2 units far apart
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Swordsman,
                x: 5,
                y: 5,
                player: 0,
            }, groundType, groundHeight, mapSize);

            executeCommand(state, {
                type: 'spawn_unit',
                unitType: UnitType.Swordsman,
                x: 10,
                y: 10,
                player: 0,
            }, groundType, groundHeight, mapSize);

            const unit1 = state.entities[0];
            const unit2 = state.entities[1];

            // Select first (normal click)
            executeCommand(state, {
                type: 'select_at_tile',
                x: unit1.x,
                y: unit1.y,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(1);

            // Shift+click second
            executeCommand(state, {
                type: 'select_at_tile',
                x: unit2.x,
                y: unit2.y,
                addToSelection: true,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(2);

            // Move both
            const result = executeCommand(state, {
                type: 'move_selected_units',
                targetX: 25,
                targetY: 25,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.unitStates.get(unit1.id)!.path.length).toBeGreaterThan(0);
            expect(state.unitStates.get(unit2.id)!.path.length).toBeGreaterThan(0);
        });
    });

    // ── Selection Area (box select) ────────────────────────────────────

    describe('Selection Area', () => {
        it('should select all units in rectangle', () => {
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 7, 7, 0);
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 20, 20, 0);

            executeCommand(state, {
                type: 'select_area',
                x1: 4,
                y1: 4,
                x2: 8,
                y2: 8,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(2);
        });

        it('should prefer units over buildings in area', () => {
            state.addEntity(EntityType.Building, 1, 10, 10, 0);
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 11, 10, 0);

            executeCommand(state, {
                type: 'select_area',
                x1: 9,
                y1: 9,
                x2: 12,
                y2: 11,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(1);
            const selectedId = Array.from(state.selectedEntityIds)[0];
            expect(state.getEntity(selectedId)!.type).toBe(EntityType.Unit);
        });

        it('should clear selection when area is empty', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'select_area',
                x1: 20,
                y1: 20,
                x2: 30,
                y2: 30,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(0);
            expect(state.selectedEntityId).toBe(null);
        });

        it('should handle reversed coordinates (bottom-right to top-left drag)', () => {
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 7, 7, 0);

            // Drag from bottom-right to top-left
            executeCommand(state, {
                type: 'select_area',
                x1: 8,
                y1: 8,
                x2: 4,
                y2: 4,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(2);
        });
    });

    // ── Deselect and Remove ────────────────────────────────────────────

    describe('Deselect and Remove', () => {
        it('should deselect all with select null', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'select',
                entityId: null,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(null);
            expect(state.selectedEntityIds.size).toBe(0);
        });

        it('should clear selection when entity is removed', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(null);
            expect(state.selectedEntityIds.size).toBe(0);
        });

        it('should remove unit state when unit is removed', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            expect(state.unitStates.has(unit.id)).toBe(true);

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(state.unitStates.has(unit.id)).toBe(false);
        });

        it('should clear tile occupancy when unit is removed', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            expect(state.getEntityAt(5, 5)).toBeDefined();

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(state.getEntityAt(5, 5)).toBeUndefined();
        });
    });

    // ── Unselectable Entities ──────────────────────────────────────────

    describe('Unselectable Entities', () => {
        it('should not select unselectable entity via select_at_tile', () => {
            // Spawn unselectable unit
            state.addEntity(EntityType.Unit, UnitType.Bearer, 10, 10, 0, false);

            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(null);
            expect(state.selectedEntityIds.size).toBe(0);
        });

        it('should not add unselectable entity with shift+click', () => {
            const selectable = state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.addEntity(EntityType.Unit, UnitType.Bearer, 10, 10, 0, false);

            // Select the selectable one
            executeCommand(state, {
                type: 'select_at_tile',
                x: 5,
                y: 5,
                addToSelection: false,
            }, groundType, groundHeight, mapSize);
            expect(state.selectedEntityIds.size).toBe(1);

            // Shift+click the unselectable one
            executeCommand(state, {
                type: 'select_at_tile',
                x: 10,
                y: 10,
                addToSelection: true,
            }, groundType, groundHeight, mapSize);

            // Should still only have the selectable one
            expect(state.selectedEntityIds.size).toBe(1);
            expect(state.selectedEntityIds.has(selectable.id)).toBe(true);
        });

        it('should exclude unselectable entities from box selection', () => {
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 5, 5, 0);
            state.addEntity(EntityType.Unit, UnitType.Bearer, 7, 7, 0, false); // unselectable
            state.addEntity(EntityType.Unit, UnitType.Swordsman, 6, 6, 0);

            executeCommand(state, {
                type: 'select_area',
                x1: 4,
                y1: 4,
                x2: 8,
                y2: 8,
            }, groundType, groundHeight, mapSize);

            // Should only select the 2 selectable units
            expect(state.selectedEntityIds.size).toBe(2);
        });

        it('should not select unselectable entity via select command', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 10, 10, 0, false);

            executeCommand(state, {
                type: 'select',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(null);
            expect(state.selectedEntityIds.size).toBe(0);
        });

        it('should not toggle unselectable entity via toggle_selection', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 10, 10, 0, false);

            const result = executeCommand(state, {
                type: 'toggle_selection',
                entityId: unit.id,
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
            expect(state.selectedEntityIds.size).toBe(0);
        });

        it('should default selectable to true for normal entities', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman, 10, 10, 0);
            expect(unit.selectable).toBe(true);
        });

        it('should track selectable=false on entity', () => {
            const unit = state.addEntity(EntityType.Unit, UnitType.Bearer, 10, 10, 0, false);
            expect(unit.selectable).toBe(false);
        });
    });
});

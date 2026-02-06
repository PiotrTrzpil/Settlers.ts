import { describe, it, expect, beforeEach } from 'vitest';
import { GameState } from '@/game/game-state';
import { BuildingConstructionPhase, EntityType } from '@/game/entity';
import { executeCommand } from '@/game/commands/command';
import { captureOriginalTerrain, applyTerrainLeveling, CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/systems/terrain-leveling';
import { MapSize } from '@/utilities/map-size';

describe('Command System', () => {
    let state: GameState;
    let mapSize: MapSize;
    let groundType: Uint8Array;
    let groundHeight: Uint8Array;

    beforeEach(() => {
        state = new GameState();
        mapSize = new MapSize(64, 64);
        groundType = new Uint8Array(64 * 64);
        groundHeight = new Uint8Array(64 * 64);
        groundType.fill(16); // all grass
    });

    describe('place_building', () => {
        it('should place building on valid tile', () => {
            const result = executeCommand(state, {
                type: 'place_building',
                buildingType: 1, // Lumberjack
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            // Lumberjack creates building + auto-spawned settler
            const building = state.entities.find(e => e.type === EntityType.Building);
            expect(building).not.toBeUndefined();
            expect(building?.x).toBe(10);
            expect(building?.y).toBe(10);
        });

        it('should reject building on water', () => {
            groundType[mapSize.toIndex(10, 10)] = 0;
            const result = executeCommand(state, {
                type: 'place_building',
                buildingType: 1, // Lumberjack
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
            expect(state.entities).toHaveLength(0);
        });

        it('should auto-spawn a worker unit adjacent to the building', () => {
            executeCommand(state, {
                type: 'place_building',
                buildingType: 1, // Lumberjack -> Settler
                x: 20,
                y: 20,
                player: 0
            }, groundType, groundHeight, mapSize);

            // Should have building + auto-spawned settler
            expect(state.entities).toHaveLength(2);
            const unit = state.entities.find(e => e.type === EntityType.Unit);
            expect(unit).not.toBeUndefined();
            if (!unit) { return }
            // Worker should be adjacent to building
            const dist = Math.abs(unit.x - 20) + Math.abs(unit.y - 20);
            expect(dist).toBeLessThanOrEqual(2); // EXTENDED_OFFSETS includes diagonals
        });

        it('should not auto-spawn for Warehouse', () => {
            executeCommand(state, {
                type: 'place_building',
                buildingType: 2, // Warehouse -> no worker
                x: 20,
                y: 20,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(state.entities).toHaveLength(1);
            expect(state.entities[0].type).toBe(EntityType.Building);
        });
    });

    describe('spawn_unit', () => {
        it('should spawn unit at given tile', () => {
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: 0,
                x: 20,
                y: 20,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.entities).toHaveLength(1);
            expect(state.entities[0].type).toBe(EntityType.Unit);
        });

        it('should spawn adjacent when tile is occupied', () => {
            // Place a warehouse (no auto-spawn) to occupy a tile
            executeCommand(state, {
                type: 'place_building',
                buildingType: 2, // Warehouse: no auto-spawn
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(state.entities).toHaveLength(1);

            // Spawn unit at same location
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: 0,
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.entities).toHaveLength(2);

            const unit = state.entities.find(e => e.type === EntityType.Unit);
            expect(unit).toBeDefined();
            if (!unit) { return }
            // Should be adjacent, not at the same spot
            const dist = Math.abs(unit.x - 10) + Math.abs(unit.y - 10);
            expect(dist).toBe(1);
        });
    });

    describe('move_unit', () => {
        it('should assign path to unit', () => {
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: 0,
                x: 5,
                y: 5,
                player: 0
            }, groundType, groundHeight, mapSize);

            const unitId = state.entities[0].id;

            const result = executeCommand(state, {
                type: 'move_unit',
                entityId: unitId,
                targetX: 10,
                targetY: 5
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            const unitState = state.unitStates.get(unitId);
            expect(unitState).toBeDefined();
            if (!unitState) { return }
            expect(unitState.path.length).toBeGreaterThan(0);
            expect(unitState.path[unitState.path.length - 1]).toEqual({ x: 10, y: 5 });
        });

        it('should fail for non-existent unit', () => {
            const result = executeCommand(state, {
                type: 'move_unit',
                entityId: 999,
                targetX: 10,
                targetY: 5
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
        });

        it('should fail when no path exists', () => {
            executeCommand(state, {
                type: 'spawn_unit',
                unitType: 0,
                x: 5,
                y: 5,
                player: 0
            }, groundType, groundHeight, mapSize);

            // Wall off the target
            for (let y = 0; y < 64; y++) {
                groundType[15 + y * 64] = 0; // water wall
            }

            const result = executeCommand(state, {
                type: 'move_unit',
                entityId: state.entities[0].id,
                targetX: 20,
                targetY: 5
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
        });
    });

    describe('select', () => {
        it('should set selectedEntityId', () => {
            state.addEntity(EntityType.Unit, 1, 5, 5, 0); // Builder (selectable)
            const unitId = state.entities[0].id;

            executeCommand(state, {
                type: 'select',
                entityId: unitId
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(unitId);
        });

        it('should allow deselection with null', () => {
            state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = state.entities[0].id;

            executeCommand(state, {
                type: 'select',
                entityId: null
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(null);
        });
    });

    describe('select_area', () => {
        it('should select units within the rectangular area', () => {
            state.addEntity(EntityType.Unit, 1, 5, 5, 0); // Builder (selectable)
            state.addEntity(EntityType.Unit, 1, 7, 7, 0);
            state.addEntity(EntityType.Unit, 1, 20, 20, 0); // outside area

            executeCommand(state, {
                type: 'select_area',
                x1: 4,
                y1: 4,
                x2: 8,
                y2: 8
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(2);
            expect(state.selectedEntityId).not.toBe(null);
        });

        it('should prefer units over buildings in area', () => {
            state.addEntity(EntityType.Building, 0, 10, 10, 0);
            state.addEntity(EntityType.Unit, 1, 11, 10, 0); // Builder (selectable)

            executeCommand(state, {
                type: 'select_area',
                x1: 9,
                y1: 9,
                x2: 12,
                y2: 11
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(1);
            const selectedId = Array.from(state.selectedEntityIds)[0];
            const selected = state.getEntity(selectedId);
            expect(selected?.type).toBe(EntityType.Unit);
        });

        it('should clear selection when area contains no entities', () => {
            state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = state.entities[0].id;

            executeCommand(state, {
                type: 'select_area',
                x1: 20,
                y1: 20,
                x2: 30,
                y2: 30
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(0);
            expect(state.selectedEntityId).toBe(null);
        });
    });

    describe('select (multi-select sync)', () => {
        it('should update selectedEntityIds when using select command', () => {
            const unit = state.addEntity(EntityType.Unit, 1, 5, 5, 0); // Builder (selectable)

            executeCommand(state, {
                type: 'select',
                entityId: unit.id
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(1);
            expect(state.selectedEntityIds.has(unit.id)).toBe(true);
        });

        it('should clear selectedEntityIds when deselecting', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'select',
                entityId: null
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).toBe(0);
        });
    });

    describe('remove_entity', () => {
        it('should remove an existing entity', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 10, 0);

            const result = executeCommand(state, {
                type: 'remove_entity',
                entityId: entity.id
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(true);
            expect(state.entities).toHaveLength(0);
            expect(state.getEntityAt(10, 10)).toBeUndefined();
        });

        it('should fail for non-existent entity', () => {
            const result = executeCommand(state, {
                type: 'remove_entity',
                entityId: 999
            }, groundType, groundHeight, mapSize);

            expect(result).toBe(false);
        });

        it('should clear selection when selected entity is removed', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).toBe(null);
        });

        it('should remove unit state along with unit entity', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            expect(state.unitStates.has(unit.id)).toBe(true);

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id
            }, groundType, groundHeight, mapSize);

            expect(state.unitStates.has(unit.id)).toBe(false);
        });

        it('should restore terrain when removing a building with modified terrain', () => {
            // Set up varied terrain heights around the building site
            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = mapSize.toIndex(10 + dx, 10 + dy);
                    groundHeight[idx] = 100 + dy * 5;
                }
            }

            // Save original terrain state for verification
            const originalGroundType = new Uint8Array(groundType);
            const originalGroundHeight = new Uint8Array(groundHeight);

            // Place a building (Lumberjack = 2x2 footprint)
            const building = state.addEntity(EntityType.Building, 1, 10, 10, 0);
            const bs = state.buildingStates.get(building.id)!;

            // Simulate terrain leveling (as building-construction.ts would do)
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);
            bs.terrainModified = true;
            bs.phase = BuildingConstructionPhase.TerrainLeveling;
            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 1.0);

            // Verify terrain was modified
            const footprintIdx = mapSize.toIndex(10, 10);
            expect(groundType[footprintIdx]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            // Remove the building
            executeCommand(state, {
                type: 'remove_entity',
                entityId: building.id
            }, groundType, groundHeight, mapSize);

            // Verify terrain was restored
            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = mapSize.toIndex(10 + dx, 10 + dy);
                    expect(groundType[idx]).toBe(originalGroundType[idx]);
                    expect(groundHeight[idx]).toBe(originalGroundHeight[idx]);
                }
            }
        });
    });
});

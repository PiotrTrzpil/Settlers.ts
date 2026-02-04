import { expect } from 'chai';
import { GameState } from '@/game/game-state';
import { EntityType } from '@/game/entity';
import { executeCommand } from '@/game/commands/command';
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
                buildingType: 0,
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).to.equal(true);
            // Guardhouse creates building + auto-spawned soldier
            const building = state.entities.find(e => e.type === EntityType.Building);
            expect(building).to.not.equal(undefined);
            expect(building?.x).to.equal(10);
            expect(building?.y).to.equal(10);
        });

        it('should reject building on water', () => {
            groundType[mapSize.toIndex(10, 10)] = 0;
            const result = executeCommand(state, {
                type: 'place_building',
                buildingType: 0,
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).to.equal(false);
            expect(state.entities).to.have.length(0);
        });

        it('should auto-spawn a worker unit adjacent to the building', () => {
            executeCommand(state, {
                type: 'place_building',
                buildingType: 0, // Guardhouse -> Soldier
                x: 20,
                y: 20,
                player: 0
            }, groundType, groundHeight, mapSize);

            // Should have building + auto-spawned soldier
            expect(state.entities).to.have.length(2);
            const unit = state.entities.find(e => e.type === EntityType.Unit);
            expect(unit).to.not.equal(undefined);
            if (!unit) { return }
            // Worker should be adjacent to building
            const dist = Math.abs(unit.x - 20) + Math.abs(unit.y - 20);
            expect(dist).to.be.lessThanOrEqual(2); // EXTENDED_OFFSETS includes diagonals
        });

        it('should not auto-spawn for Warehouse', () => {
            executeCommand(state, {
                type: 'place_building',
                buildingType: 2, // Warehouse -> no worker
                x: 20,
                y: 20,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(state.entities).to.have.length(1);
            expect(state.entities[0].type).to.equal(EntityType.Building);
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

            expect(result).to.equal(true);
            expect(state.entities).to.have.length(1);
            expect(state.entities[0].type).to.equal(EntityType.Unit);
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

            expect(state.entities).to.have.length(1);

            // Spawn unit at same location
            const result = executeCommand(state, {
                type: 'spawn_unit',
                unitType: 0,
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

            expect(result).to.equal(true);
            expect(state.entities).to.have.length(2);

            const unit = state.entities.find(e => e.type === EntityType.Unit);
            expect(unit).to.not.equal(undefined);
            if (!unit) { return }
            // Should be adjacent, not at the same spot
            const dist = Math.abs(unit.x - 10) + Math.abs(unit.y - 10);
            expect(dist).to.equal(1);
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

            expect(result).to.equal(true);
            const unitState = state.unitStates.get(unitId);
            expect(unitState).to.not.equal(undefined);
            if (!unitState) { return }
            expect(unitState.path.length).to.be.greaterThan(0);
            expect(unitState.path[unitState.path.length - 1]).to.deep.equal({ x: 10, y: 5 });
        });

        it('should fail for non-existent unit', () => {
            const result = executeCommand(state, {
                type: 'move_unit',
                entityId: 999,
                targetX: 10,
                targetY: 5
            }, groundType, groundHeight, mapSize);

            expect(result).to.equal(false);
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

            expect(result).to.equal(false);
        });
    });

    describe('select', () => {
        it('should set selectedEntityId', () => {
            state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            const unitId = state.entities[0].id;

            executeCommand(state, {
                type: 'select',
                entityId: unitId
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).to.equal(unitId);
        });

        it('should allow deselection with null', () => {
            state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = state.entities[0].id;

            executeCommand(state, {
                type: 'select',
                entityId: null
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).to.equal(null);
        });
    });

    describe('select_area', () => {
        it('should select units within the rectangular area', () => {
            state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.addEntity(EntityType.Unit, 0, 7, 7, 0);
            state.addEntity(EntityType.Unit, 0, 20, 20, 0); // outside area

            executeCommand(state, {
                type: 'select_area',
                x1: 4,
                y1: 4,
                x2: 8,
                y2: 8
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).to.equal(2);
            expect(state.selectedEntityId).to.not.equal(null);
        });

        it('should prefer units over buildings in area', () => {
            state.addEntity(EntityType.Building, 0, 10, 10, 0);
            state.addEntity(EntityType.Unit, 0, 11, 10, 0);

            executeCommand(state, {
                type: 'select_area',
                x1: 9,
                y1: 9,
                x2: 12,
                y2: 11
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).to.equal(1);
            const selectedId = Array.from(state.selectedEntityIds)[0];
            const selected = state.getEntity(selectedId);
            expect(selected?.type).to.equal(EntityType.Unit);
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

            expect(state.selectedEntityIds.size).to.equal(0);
            expect(state.selectedEntityId).to.equal(null);
        });
    });

    describe('select (multi-select sync)', () => {
        it('should update selectedEntityIds when using select command', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);

            executeCommand(state, {
                type: 'select',
                entityId: unit.id
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).to.equal(1);
            expect(state.selectedEntityIds.has(unit.id)).to.equal(true);
        });

        it('should clear selectedEntityIds when deselecting', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityIds.add(unit.id);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'select',
                entityId: null
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityIds.size).to.equal(0);
        });
    });

    describe('remove_entity', () => {
        it('should remove an existing entity', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 10, 0);

            const result = executeCommand(state, {
                type: 'remove_entity',
                entityId: entity.id
            }, groundType, groundHeight, mapSize);

            expect(result).to.equal(true);
            expect(state.entities).to.have.length(0);
            expect(state.getEntityAt(10, 10)).to.equal(undefined);
        });

        it('should fail for non-existent entity', () => {
            const result = executeCommand(state, {
                type: 'remove_entity',
                entityId: 999
            }, groundType, groundHeight, mapSize);

            expect(result).to.equal(false);
        });

        it('should clear selection when selected entity is removed', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = unit.id;

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id
            }, groundType, groundHeight, mapSize);

            expect(state.selectedEntityId).to.equal(null);
        });

        it('should remove unit state along with unit entity', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            expect(state.unitStates.has(unit.id)).to.equal(true);

            executeCommand(state, {
                type: 'remove_entity',
                entityId: unit.id
            }, groundType, groundHeight, mapSize);

            expect(state.unitStates.has(unit.id)).to.equal(false);
        });
    });
});

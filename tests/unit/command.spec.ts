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
            expect(state.entities).to.have.length(1);
            expect(state.entities[0].type).to.equal(EntityType.Building);
            expect(state.entities[0].x).to.equal(10);
            expect(state.entities[0].y).to.equal(10);
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
            // Place a building first
            executeCommand(state, {
                type: 'place_building',
                buildingType: 0,
                x: 10,
                y: 10,
                player: 0
            }, groundType, groundHeight, mapSize);

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
});

import { expect } from 'chai';
import { GameState } from '@/game/game-state';
import { EntityType } from '@/game/entity';

describe('GameState', () => {
    let state: GameState;

    beforeEach(() => {
        state = new GameState();
    });

    describe('addEntity', () => {
        it('should add a building entity with correct properties', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 20, 0);

            expect(entity.id).to.equal(1);
            expect(entity.type).to.equal(EntityType.Building);
            expect(entity.subType).to.equal(0);
            expect(entity.x).to.equal(10);
            expect(entity.y).to.equal(20);
            expect(entity.player).to.equal(0);
            expect(state.entities).to.have.length(1);
        });

        it('should add a unit entity with UnitState', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);

            expect(entity.type).to.equal(EntityType.Unit);
            expect(state.unitStates.has(entity.id)).to.equal(true);

            const unitState = state.unitStates.get(entity.id);
            expect(unitState).to.not.equal(undefined);
            if (!unitState) { return }
            expect(unitState.entityId).to.equal(entity.id);
            expect(unitState.path).to.have.length(0);
            expect(unitState.speed).to.equal(2);
        });

        it('should not create UnitState for buildings', () => {
            const entity = state.addEntity(EntityType.Building, 0, 5, 5, 0);
            expect(state.unitStates.has(entity.id)).to.equal(false);
        });

        it('should assign incrementing IDs', () => {
            const e1 = state.addEntity(EntityType.Unit, 0, 0, 0, 0);
            const e2 = state.addEntity(EntityType.Building, 0, 1, 1, 0);
            const e3 = state.addEntity(EntityType.Unit, 1, 2, 2, 0);

            expect(e1.id).to.equal(1);
            expect(e2.id).to.equal(2);
            expect(e3.id).to.equal(3);
        });

        it('should update tile occupancy', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 20, 0);
            expect(state.tileOccupancy.get('10,20')).to.equal(entity.id);
        });
    });

    describe('removeEntity', () => {
        it('should remove entity from entities array', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.removeEntity(entity.id);
            expect(state.entities).to.have.length(0);
        });

        it('should remove tile occupancy', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 10, 0);
            state.removeEntity(entity.id);
            expect(state.tileOccupancy.has('10,10')).to.equal(false);
        });

        it('should remove UnitState for units', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.removeEntity(entity.id);
            expect(state.unitStates.has(entity.id)).to.equal(false);
        });

        it('should clear selection if removed entity was selected', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = entity.id;
            state.removeEntity(entity.id);
            expect(state.selectedEntityId).to.equal(null);
        });

        it('should not affect other entities', () => {
            const e1 = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            const e2 = state.addEntity(EntityType.Unit, 0, 10, 10, 0);
            state.removeEntity(e1.id);
            expect(state.entities).to.have.length(1);
            expect(state.entities[0].id).to.equal(e2.id);
        });
    });

    describe('getEntityAt', () => {
        it('should return entity at given tile', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 20, 0);
            const found = state.getEntityAt(10, 20);
            expect(found).to.not.equal(undefined);
            expect(found?.id).to.equal(entity.id);
        });

        it('should return undefined for empty tile', () => {
            expect(state.getEntityAt(0, 0)).to.equal(undefined);
        });
    });

    describe('getEntitiesInRadius', () => {
        it('should return entities within radius', () => {
            state.addEntity(EntityType.Unit, 0, 10, 10, 0);
            state.addEntity(EntityType.Unit, 0, 11, 10, 0);
            state.addEntity(EntityType.Unit, 0, 50, 50, 0);

            const nearby = state.getEntitiesInRadius(10, 10, 3);
            expect(nearby).to.have.length(2);
        });
    });

    describe('updateEntityPosition', () => {
        it('should update entity coordinates and occupancy', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.updateEntityPosition(entity.id, 10, 10);

            expect(entity.x).to.equal(10);
            expect(entity.y).to.equal(10);
            expect(state.tileOccupancy.has('5,5')).to.equal(false);
            expect(state.tileOccupancy.get('10,10')).to.equal(entity.id);
        });
    });
});

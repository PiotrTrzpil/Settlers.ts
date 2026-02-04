import { describe, it, expect, beforeEach } from 'vitest';
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

            expect(entity.id).toBe(1);
            expect(entity.type).toBe(EntityType.Building);
            expect(entity.subType).toBe(0);
            expect(entity.x).toBe(10);
            expect(entity.y).toBe(20);
            expect(entity.player).toBe(0);
            expect(state.entities).toHaveLength(1);
        });

        it('should add a unit entity with UnitState', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);

            expect(entity.type).toBe(EntityType.Unit);
            expect(state.unitStates.has(entity.id)).toBe(true);

            const unitState = state.unitStates.get(entity.id);
            expect(unitState).toBeDefined();
            if (!unitState) { return }
            expect(unitState.entityId).toBe(entity.id);
            expect(unitState.path).toHaveLength(0);
            expect(unitState.speed).toBe(2);
        });

        it('should not create UnitState for buildings', () => {
            const entity = state.addEntity(EntityType.Building, 0, 5, 5, 0);
            expect(state.unitStates.has(entity.id)).toBe(false);
        });

        it('should assign incrementing IDs', () => {
            const e1 = state.addEntity(EntityType.Unit, 0, 0, 0, 0);
            const e2 = state.addEntity(EntityType.Building, 0, 1, 1, 0);
            const e3 = state.addEntity(EntityType.Unit, 1, 2, 2, 0);

            expect(e1.id).toBe(1);
            expect(e2.id).toBe(2);
            expect(e3.id).toBe(3);
        });

        it('should update tile occupancy', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 20, 0);
            expect(state.tileOccupancy.get('10,20')).toBe(entity.id);
        });
    });

    describe('removeEntity', () => {
        it('should remove entity from entities array', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.removeEntity(entity.id);
            expect(state.entities).toHaveLength(0);
        });

        it('should remove tile occupancy', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 10, 0);
            state.removeEntity(entity.id);
            expect(state.tileOccupancy.has('10,10')).toBe(false);
        });

        it('should remove UnitState for units', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.removeEntity(entity.id);
            expect(state.unitStates.has(entity.id)).toBe(false);
        });

        it('should clear selection if removed entity was selected', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.selectedEntityId = entity.id;
            state.removeEntity(entity.id);
            expect(state.selectedEntityId).toBe(null);
        });

        it('should not affect other entities', () => {
            const e1 = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            const e2 = state.addEntity(EntityType.Unit, 0, 10, 10, 0);
            state.removeEntity(e1.id);
            expect(state.entities).toHaveLength(1);
            expect(state.entities[0].id).toBe(e2.id);
        });
    });

    describe('getEntityAt', () => {
        it('should return entity at given tile', () => {
            const entity = state.addEntity(EntityType.Building, 0, 10, 20, 0);
            const found = state.getEntityAt(10, 20);
            expect(found).toBeDefined();
            expect(found?.id).toBe(entity.id);
        });

        it('should return undefined for empty tile', () => {
            expect(state.getEntityAt(0, 0)).toBe(undefined);
        });
    });

    describe('getEntitiesInRadius', () => {
        it('should return entities within radius', () => {
            state.addEntity(EntityType.Unit, 0, 10, 10, 0);
            state.addEntity(EntityType.Unit, 0, 11, 10, 0);
            state.addEntity(EntityType.Unit, 0, 50, 50, 0);

            const nearby = state.getEntitiesInRadius(10, 10, 3);
            expect(nearby).toHaveLength(2);
        });
    });

    describe('updateEntityPosition', () => {
        it('should update entity coordinates and occupancy', () => {
            const entity = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            state.updateEntityPosition(entity.id, 10, 10);

            expect(entity.x).toBe(10);
            expect(entity.y).toBe(10);
            expect(state.tileOccupancy.has('5,5')).toBe(false);
            expect(state.tileOccupancy.get('10,10')).toBe(entity.id);
        });
    });
});

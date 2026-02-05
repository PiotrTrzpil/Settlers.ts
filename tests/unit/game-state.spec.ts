import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit, addBuilding } from './helpers/test-game';
import type { GameState } from '@/game/game-state';

// Note: Basic add/remove/getEntityAt/selection tests are covered by flow tests
// in flows/. This file focuses on edge cases and invariants only.

describe('GameState – edge cases', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('should not create UnitState for buildings', () => {
        const entity = addBuilding(state, 5, 5, 0, 0);
        expect(state.unitStates.has(entity.id)).toBe(false);
    });

    it('should assign incrementing IDs', () => {
        const { entity: e1 } = addUnit(state, 0, 0);
        const e2 = addBuilding(state, 1, 1, 0, 0);
        const { entity: e3 } = addUnit(state, 2, 2, { subType: 1 });

        expect(e1.id).toBe(1);
        expect(e2.id).toBe(2);
        expect(e3.id).toBe(3);
    });

    it('should not affect other entities when removing one', () => {
        const { entity: e1 } = addUnit(state, 5, 5);
        const { entity: e2 } = addUnit(state, 10, 10);
        state.removeEntity(e1.id);
        expect(state.entities).toHaveLength(1);
        expect(state.entities[0].id).toBe(e2.id);
    });

    it('should update entity coordinates and occupancy', () => {
        const { entity } = addUnit(state, 5, 5);
        state.updateEntityPosition(entity.id, 10, 10);

        expect(entity.x).toBe(10);
        expect(entity.y).toBe(10);
        expect(state.tileOccupancy.has('5,5')).toBe(false);
        expect(state.tileOccupancy.get('10,10')).toBe(entity.id);
    });
});

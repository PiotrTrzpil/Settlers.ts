import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit, addUnitWithPath } from './helpers/test-game';
import type { GameState } from '@/game/game-state';

// Note: Movement happy paths (advance, complete, multi-unit, occupancy, interpolation)
// are covered by unit-lifecycle flow tests in flows/.
// This file focuses on edge cases only.

describe('Movement System – edge cases', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('should not move units with empty path', () => {
        const { entity: unit } = addUnit(state, 5, 5);

        state.movement.update(1.0);

        expect(unit.x).toBe(5);
        expect(unit.y).toBe(5);
    });

    it('should advance unit along path based on speed', () => {
        const { entity: unit, unitState } = addUnitWithPath(state, 0, 0, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
        ], 2);

        // 0.5 seconds at speed 2 = 1 tile
        state.movement.update(0.5);

        expect(unit.x).toBe(1);
        expect(unit.y).toBe(0);
        expect(unitState.pathIndex).toBe(1);
    });
});

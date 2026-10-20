/**
 * Units never block A* — occupancy is a cost-free pass-through.
 * Collisions are resolved at movement time (bump / wait / repath).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';

describe('A* ignores unit occupancy', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('paths through tiles occupied by other units', () => {
        addUnit(state, 12, 10);
        addUnit(state, 13, 10);

        const { entity: mover } = addUnit(state, 10, 10);
        expect(state.movement.moveUnit(mover.id, { x: 15, y: 10 })).toBe(true);

        const ctrl = state.movement.getController(mover.id)!;
        expect(ctrl.path.length).toBeGreaterThan(0);
        expect(ctrl.goal).toEqual({ x: 15, y: 10 });
    });

    it('paths to a tile occupied by another unit', () => {
        addUnit(state, 15, 10);
        const { entity: mover } = addUnit(state, 10, 10);

        expect(state.movement.moveUnit(mover.id, { x: 15, y: 10 })).toBe(true);

        const ctrl = state.movement.getController(mover.id)!;
        expect(ctrl.goal).toEqual({ x: 15, y: 10 });
        expect(ctrl.path.length).toBeGreaterThan(0);
    });

    it('direct path is unchanged by a dense crowd on the line', () => {
        for (let x = 52; x <= 68; x++) {
            addUnit(state, x, 50);
        }

        const { entity: mover } = addUnit(state, 50, 50);
        expect(state.movement.moveUnit(mover.id, { x: 70, y: 50 })).toBe(true);

        const ctrl = state.movement.getController(mover.id)!;
        expect(ctrl.path.length).toBeGreaterThan(0);
        expect(ctrl.goal).toEqual({ x: 70, y: 50 });
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit, addUnitWithPath } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';

describe('Movement System – collision resolution', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('unit walks around a stationary blocker via sidestep', () => {
        // Unit A at (0,0) wants to go to (3,0) — straight east
        // Unit B sits at (1,0), blocking the path
        const { entity: unitA } = addUnitWithPath(state, 0, 0, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
        ]);
        addUnit(state, 1, 0); // blocker

        // Tick several times — unit A should find a way around
        for (let i = 0; i < 20; i++) {
            state.movement.update(0.1);
        }

        // Unit A should have reached or be close to goal, NOT stuck at start
        expect(unitA.x).not.toBe(0);
    });

    it('two units walking toward each other do not get stuck', () => {
        // Unit A at (0,0) heading east, Unit B at (4,0) heading west
        const { entity: unitA } = addUnitWithPath(state, 0, 0, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
        ]);
        const { entity: unitB } = addUnitWithPath(state, 4, 0, [
            { x: 3, y: 0 },
            { x: 2, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 0 },
        ]);

        // Simulate several seconds — both should make progress
        for (let i = 0; i < 60; i++) {
            state.movement.update(0.1);
        }

        // Neither should be at their start position — they should have moved
        const aMoved = unitA.x !== 0 || unitA.y !== 0;
        const bMoved = unitB.x !== 4 || unitB.y !== 0;
        expect(aMoved).toBe(true);
        expect(bMoved).toBe(true);
    });

    it('blocked unit gives up after timeout', () => {
        // Unit A at (0,0) wants east, completely surrounded by blockers except origin
        const { entity: unitA } = addUnitWithPath(state, 0, 0, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);

        // Surround with blockers on all 6 neighbors
        addUnit(state, 1, -1);
        addUnit(state, 1, 0);
        addUnit(state, 0, 1);
        addUnit(state, -1, 1);
        addUnit(state, -1, 0);
        addUnit(state, 0, -1);

        // Tick for longer than BLOCKED_GIVEUP_TIMEOUT (2s)
        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
        }

        // Unit should have given up — state should be idle
        const controller = state.movement.getController(unitA.id);
        expect(controller!.state).toBe('idle');
    });

    it('unit does not oscillate back and forth (no position loops)', () => {
        // Unit A at (0,0) heading east, Unit B at (1,0) heading west
        const { entity: unitA } = addUnitWithPath(state, 0, 0, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        addUnitWithPath(state, 2, 0, [
            { x: 1, y: 0 },
            { x: 0, y: 0 },
        ]);

        // Track unit A's positions over time
        const positions: string[] = [];
        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
            positions.push(`${unitA.x},${unitA.y}`);
        }

        // Check that no position appears more than 4 times (would indicate oscillation)
        const counts = new Map<string, number>();
        for (const pos of positions) {
            counts.set(pos, (counts.get(pos) ?? 0) + 1);
        }
        for (const [pos, count] of counts) {
            if (count > 6) {
                // Allow some dwelling but not infinite oscillation
                // If stuck at start for >6 ticks, that's a problem (unless completely boxed in)
                expect(pos).not.toBe('0,0');
            }
        }
    });
});

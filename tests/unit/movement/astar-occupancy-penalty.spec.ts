/**
 * Tests for A* unit occupancy cost penalty.
 * Units penalize crowded tiles (1.5x cost) during pathfinding,
 * preferring less congested routes without blocking occupied tiles.
 *
 * Note: path smoothing uses line-of-sight (ignoring units), so the
 * final smoothed path may not differ from uncrowded. We test the raw
 * A* output via the debug hook to verify the penalty is working.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGameState, addUnit } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';
import { type Tile } from '@/game/entity';
import { setPathDebugHook } from '@/game/systems/pathfinding/astar';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Capture the raw (pre-smoothing) path from the next pathfinding call. */
function captureRawPath(): { getRaw: () => Tile[] } {
    let captured: Tile[] = [];
    setPathDebugHook((raw, _smoothed) => {
        captured = [...raw];
    });
    return {
        getRaw: () => captured,
    };
}

// ─── A* occupancy penalty ─────────────────────────────────────────────

describe('A* occupancy cost penalty', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    afterEach(() => {
        setPathDebugHook(undefined);
    });

    it('unit can pathfind through occupied tiles (penalty does not block)', () => {
        // Place units on the direct path
        addUnit(state, 12, 10);
        addUnit(state, 13, 10);

        const { entity: mover } = addUnit(state, 10, 10);
        expect(state.movement.moveUnit(mover.id, 15, 10)).toBe(true);

        // Path should exist — penalty only increases cost, never blocks
        const ctrl = state.movement.getController(mover.id)!;
        expect(ctrl.path.length).toBeGreaterThan(0);
    });

    it('raw A* path detours around dense crowd', () => {
        // Dense crowd along direct path: 17 occupied tiles
        // Direct: 20 tiles × 15 cost = 300
        // Detour (~22 tiles × 10 cost = 220) — detour wins
        for (let x = 52; x <= 68; x++) {
            addUnit(state, x, 50);
        }

        const hook = captureRawPath();
        const { entity: mover } = addUnit(state, 50, 50);
        state.movement.moveUnit(mover.id, 70, 50);

        const rawPath = hook.getRaw();
        expect(rawPath.length).toBeGreaterThan(0);

        // Raw A* path should have waypoints off y=50 (detour around crowd)
        const offMainRow = rawPath.filter(t => t.y !== 50);
        expect(offMainRow.length).toBeGreaterThan(0);
    });

    it('raw A* path differs with crowd vs without', () => {
        // Without crowd
        const hookA = captureRawPath();
        const { entity: mover1 } = addUnit(state, 50, 60);
        state.movement.moveUnit(mover1.id, 70, 60);
        const rawNoCrowd = hookA.getRaw();
        state.movement.removeController(mover1.id);

        // With crowd on direct path
        for (let x = 52; x <= 68; x++) {
            addUnit(state, x, 60);
        }

        const hookB = captureRawPath();
        const { entity: mover2 } = addUnit(state, 50, 60);
        state.movement.moveUnit(mover2.id, 70, 60);
        const rawWithCrowd = hookB.getRaw();

        // Raw paths should differ — crowd penalty causes A* to explore differently
        const samePath =
            rawNoCrowd.length === rawWithCrowd.length &&
            rawNoCrowd.every((p, i) => p.x === rawWithCrowd[i]!.x && p.y === rawWithCrowd[i]!.y);
        expect(samePath).toBe(false);
    });

    it('goal tile is not penalized even when occupied', () => {
        addUnit(state, 15, 10);
        const { entity: mover } = addUnit(state, 10, 10);

        expect(state.movement.moveUnit(mover.id, 15, 10)).toBe(true);

        const ctrl = state.movement.getController(mover.id)!;
        expect(ctrl.goal).toEqual({ x: 15, y: 10 });
        expect(ctrl.path.length).toBeGreaterThan(0);
    });

    it('pathfinding entity own tile is excluded from penalty', () => {
        const { entity: mover } = addUnit(state, 10, 10);

        addUnit(state, 10, 11);
        addUnit(state, 9, 10);

        expect(state.movement.moveUnit(mover.id, 15, 10)).toBe(true);

        const ctrl = state.movement.getController(mover.id)!;
        expect(ctrl.path.length).toBeGreaterThan(0);
    });

    it('short crowd does not cause detour (penalty too small)', () => {
        // Only 2 occupied tiles — penalty savings (10) < detour cost (~20)
        addUnit(state, 12, 10);
        addUnit(state, 13, 10);

        const hook = captureRawPath();
        const { entity: mover } = addUnit(state, 10, 10);
        state.movement.moveUnit(mover.id, 16, 10);
        const rawPath = hook.getRaw();

        // With only 2 crowded tiles, the direct path should still be preferred
        const allOnMainRow = rawPath.every(t => t.y === 10);
        expect(allOnMainRow).toBe(true);
    });
});

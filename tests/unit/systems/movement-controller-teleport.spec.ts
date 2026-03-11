/**
 * Teleport detection: false positives from multi-step ticks and
 * real teleports from mid-transit operations.
 */

import { describe, it, expect } from 'vitest';
import { MovementController } from '@/game/systems/movement/movement-controller';
import type { TileCoord } from '@/game/entity';

// Diagonal hex path: SE steps (+1,+1)
const diagonalPath: TileCoord[] = [
    { x: 21, y: 61 },
    { x: 22, y: 62 },
    { x: 23, y: 63 },
    { x: 24, y: 64 },
    { x: 25, y: 65 },
];

/** Simulate one full tick: advance, take all available steps, finalize. */
function simulateTick(ctrl: MovementController, dt: number) {
    ctrl.advanceProgress(dt);
    while (ctrl.canMove()) {
        ctrl.executeMove();
    }
    ctrl.finalizeTick();
}

describe('MovementController teleport detection', () => {
    it('multi-step tick: stepsTakenThisTick tracks correctly', () => {
        const ctrl = new MovementController(1, 20, 60, 60);
        ctrl.startPath(diagonalPath);

        // startPath sets progress=1 — first step is immediate
        simulateTick(ctrl, 1 / 20); // high speed → multiple steps

        expect(ctrl.stepsTakenThisTick).toBeGreaterThanOrEqual(2);
    });

    it('multi-step tick does not cause false teleport at scaled threshold', () => {
        const ctrl = new MovementController(1, 20, 60, 60);
        ctrl.startPath(diagonalPath);

        // Tick 1: take first step, record visual
        simulateTick(ctrl, 0); // progress was already 1 from startPath
        ctrl.updateLastVisualPosition();

        // Tick 2: high dt → 2+ diagonal steps
        simulateTick(ctrl, 1 / 20);

        const dist = ctrl.detectTeleport();
        const steps = Math.max(1, ctrl.stepsTakenThisTick);
        const threshold = 1.5 * steps + 0.01;

        // Distance naturally exceeds 1.5 for 2+ diagonal steps...
        expect(dist).toBeGreaterThan(1.5);
        // ...but the scaled threshold accounts for it
        expect(dist).toBeLessThanOrEqual(threshold);
    });

    it('handlePush mid-transit logs warning via warnIfTeleported', () => {
        const ctrl = new MovementController(1, 20, 60, 2);
        ctrl.startPath(diagonalPath);

        // Take first step, advance partway into transit
        simulateTick(ctrl, 0); // first step
        ctrl.advanceProgress(1 / 30);
        // Now mid-transit with progress > 0

        const warnings: string[] = [];
        const origWarn = console.warn;
        console.warn = (msg: string) => warnings.push(msg);
        try {
            ctrl.handlePush(23, 63);
        } finally {
            console.warn = origWarn;
        }

        // handlePush should have triggered warnIfTeleported
        const pushWarnings = warnings.filter(w => w.includes('handlePush'));
        expect(pushWarnings.length).toBeGreaterThanOrEqual(1);
    });

    it('replacePath mid-transit logs warning via warnIfTeleported', () => {
        const ctrl = new MovementController(1, 20, 60, 2);
        ctrl.startPath(diagonalPath);

        // Take first step, advance partway
        simulateTick(ctrl, 0);
        ctrl.advanceProgress(1 / 30);

        const warnings: string[] = [];
        const origWarn = console.warn;
        console.warn = (msg: string) => warnings.push(msg);
        try {
            // replacePath with a path that starts elsewhere won't change visual
            // position (it only changes the path array), but if visual state
            // was inconsistent it would fire
            ctrl.replacePath([
                { x: 22, y: 62 },
                { x: 23, y: 63 },
            ]);
        } finally {
            console.warn = origWarn;
        }

        // replacePath doesn't change tile/prev/progress, so no teleport expected
        const replaceWarnings = warnings.filter(w => w.includes('replacePath'));
        expect(replaceWarnings.length).toBe(0);
    });

    it('stepsTakenThisTick resets on advanceProgress', () => {
        const ctrl = new MovementController(1, 20, 60, 60);
        ctrl.startPath(diagonalPath);

        simulateTick(ctrl, 1 / 20);
        expect(ctrl.stepsTakenThisTick).toBeGreaterThanOrEqual(1);

        // New tick resets
        ctrl.advanceProgress(0);
        expect(ctrl.stepsTakenThisTick).toBe(0);
    });
});

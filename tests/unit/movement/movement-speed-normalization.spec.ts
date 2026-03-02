import { describe, it, expect } from 'vitest';
import { MovementController } from '@/game/systems/movement/movement-controller';
import { getStepDistanceFactor } from '@/game/systems/hex-directions';

describe('Movement speed normalization', () => {
    describe('getStepDistanceFactor', () => {
        it('should return correct factor for each direction', () => {
            expect(getStepDistanceFactor(1, 0)).toBe(1.0); // EAST
            expect(getStepDistanceFactor(-1, 0)).toBe(1.0); // WEST
            expect(getStepDistanceFactor(1, -1)).toBeCloseTo(Math.sqrt(2.5)); // NE
            expect(getStepDistanceFactor(-1, 1)).toBeCloseTo(Math.sqrt(2.5)); // SW
            expect(getStepDistanceFactor(0, 1)).toBeCloseTo(Math.sqrt(0.5)); // SE
            expect(getStepDistanceFactor(0, -1)).toBeCloseTo(Math.sqrt(0.5)); // NW
        });

        it('should return 1.0 for zero step', () => {
            expect(getStepDistanceFactor(0, 0)).toBe(1.0);
        });
    });

    describe('MovementController speed normalization', () => {
        it('should take longer for NE steps than EAST steps', () => {
            // EAST path: distance factor = 1.0
            const eastCtrl = new MovementController(1, 0, 0, 2.0);
            eastCtrl.startPath([
                { x: 1, y: 0 },
                { x: 2, y: 0 },
            ]);

            // NE path: distance factor = sqrt(2.5) ≈ 1.581
            const neCtrl = new MovementController(2, 0, 0, 2.0);
            neCtrl.startPath([
                { x: 1, y: -1 },
                { x: 2, y: -2 },
            ]);

            // After first step (startPath sets progress=1), execute the move
            eastCtrl.executeMove();
            neCtrl.executeMove();

            // Now advance by 0.3 seconds at speed 2.0
            // EAST: progress += 2.0 * 0.3 / 1.0 = 0.6
            // NE: progress += 2.0 * 0.3 / 1.581 ≈ 0.379
            eastCtrl.advanceProgress(0.3);
            neCtrl.advanceProgress(0.3);

            expect(eastCtrl.progress).toBeCloseTo(0.6, 5);
            expect(neCtrl.progress).toBeCloseTo(0.6 / Math.sqrt(2.5), 5);
            expect(neCtrl.progress).toBeLessThan(eastCtrl.progress);
        });

        it('should take shorter for SE steps than EAST steps', () => {
            // SE path: distance factor = sqrt(0.5) ≈ 0.707
            const seCtrl = new MovementController(1, 0, 0, 2.0);
            seCtrl.startPath([
                { x: 0, y: 1 },
                { x: 0, y: 2 },
            ]);

            // Execute first move to set distance factor
            seCtrl.executeMove();

            // Advance by 0.3 seconds
            // SE: progress += 2.0 * 0.3 / 0.707 ≈ 0.849
            seCtrl.advanceProgress(0.3);

            expect(seCtrl.progress).toBeCloseTo(0.6 / Math.sqrt(0.5), 5);
            expect(seCtrl.progress).toBeGreaterThan(0.6); // > EAST's progress
        });
    });
});

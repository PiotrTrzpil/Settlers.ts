import { describe, it, expect } from 'vitest';
import { MovementController } from '@/game/systems/movement/movement-controller';
import { WORLD_DISTANCE_PER_DIRECTION, getStepDistanceFactor, EDirection } from '@/game/systems/hex-directions';

describe('Movement speed normalization', () => {
    describe('world distance constants', () => {
        it('should have EAST/WEST distance of 1.0', () => {
            expect(WORLD_DISTANCE_PER_DIRECTION[EDirection.EAST]).toBe(1.0);
            expect(WORLD_DISTANCE_PER_DIRECTION[EDirection.WEST]).toBe(1.0);
        });

        it('should have NE/SW distance of sqrt(2.5)', () => {
            expect(WORLD_DISTANCE_PER_DIRECTION[EDirection.NORTH_EAST]).toBeCloseTo(Math.sqrt(2.5), 10);
            expect(WORLD_DISTANCE_PER_DIRECTION[EDirection.SOUTH_WEST]).toBeCloseTo(Math.sqrt(2.5), 10);
        });

        it('should have SE/NW distance of sqrt(0.5)', () => {
            expect(WORLD_DISTANCE_PER_DIRECTION[EDirection.SOUTH_EAST]).toBeCloseTo(Math.sqrt(0.5), 10);
            expect(WORLD_DISTANCE_PER_DIRECTION[EDirection.NORTH_WEST]).toBeCloseTo(Math.sqrt(0.5), 10);
        });
    });

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

        it('should normalize so visual speed is equal in all directions', () => {
            // A unit at speed 2.0 tiles/sec should cover the same WORLD distance per second
            // regardless of direction.
            //
            // Time per tile step = distanceFactor / speed
            // World distance per step = distanceFactor
            // World speed = distanceFactor / (distanceFactor / speed) = speed
            //
            // So all directions should have the same world-space speed = 2.0 world units/sec

            const speed = 2.0;

            for (const [dx, dy] of [
                [1, 0],
                [1, -1],
                [0, 1],
                [-1, 1],
                [-1, 0],
                [0, -1],
            ] as const) {
                const factor = getStepDistanceFactor(dx, dy);
                // Time to complete one tile = factor / speed
                const timePerTile = factor / speed;
                // World distance per tile = factor
                // Visual speed = factor / timePerTile = speed
                expect(factor / timePerTile).toBeCloseTo(speed, 10);
            }
        });
    });
});

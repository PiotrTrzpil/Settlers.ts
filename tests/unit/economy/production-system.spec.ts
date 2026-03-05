import { describe, it, expect, beforeEach } from 'vitest';
import { ProductionControlManager, ProductionMode } from '@/game/features/production-control';

describe('ProductionControlManager', () => {
    let pcm: ProductionControlManager;

    beforeEach(() => {
        pcm = new ProductionControlManager();
    });

    describe('even mode (default)', () => {
        it('round-robins through recipe indices', () => {
            pcm.initBuilding(1, 3);
            expect(pcm.getNextRecipeIndex(1)).toBe(0);
            expect(pcm.getNextRecipeIndex(1)).toBe(1);
            expect(pcm.getNextRecipeIndex(1)).toBe(2);
            expect(pcm.getNextRecipeIndex(1)).toBe(0); // wraps
        });
    });

    describe('proportional mode', () => {
        it('converges toward target proportions over many cycles', () => {
            pcm.initBuilding(1, 2);
            pcm.setMode(1, ProductionMode.Proportional);
            pcm.setProportion(1, 0, 3);
            pcm.setProportion(1, 1, 1);

            const counts = [0, 0];
            for (let i = 0; i < 40; i++) {
                const idx = pcm.getNextRecipeIndex(1)!;
                counts[idx] = (counts[idx] ?? 0) + 1;
            }

            expect(counts[0]! / counts[1]!).toBeCloseTo(3, 0);
        });
    });

    describe('manual mode', () => {
        it('follows queue order and depletes one item at a time', () => {
            pcm.initBuilding(1, 4);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 2);
            pcm.addToQueue(1, 0);
            pcm.addToQueue(1, 3);

            expect(pcm.getNextRecipeIndex(1)).toBe(2);
            expect(pcm.getNextRecipeIndex(1)).toBe(0);
            expect(pcm.getNextRecipeIndex(1)).toBe(3);
            expect(pcm.getNextRecipeIndex(1)).toBeNull(); // empty
        });

        it('removeFromQueue removes last occurrence', () => {
            pcm.initBuilding(1, 3);
            pcm.setMode(1, ProductionMode.Manual);
            pcm.addToQueue(1, 0);
            pcm.addToQueue(1, 1);
            pcm.addToQueue(1, 0);
            pcm.removeFromQueue(1, 0);
            expect(pcm.getProductionState(1)!.queue).toEqual([0, 1]);
        });
    });

    describe('setProportion', () => {
        it('clamps weight to [0, 10]', () => {
            pcm.initBuilding(1, 2);
            pcm.setProportion(1, 0, 15);
            pcm.setProportion(1, 1, -5);
            const state = pcm.getProductionState(1)!;
            expect(state.proportions.get(0)).toBe(10);
            expect(state.proportions.get(1)).toBe(0);
        });
    });

    describe('building isolation', () => {
        it('maintains separate states per building', () => {
            pcm.initBuilding(1, 3);
            pcm.initBuilding(2, 5);
            pcm.getNextRecipeIndex(1);
            pcm.getNextRecipeIndex(1);

            expect(pcm.getNextRecipeIndex(2)).toBe(0);
            expect(pcm.getNextRecipeIndex(1)).toBe(2);
        });

        it('removeBuilding only affects the removed building', () => {
            pcm.initBuilding(1, 2);
            pcm.initBuilding(2, 2);
            pcm.removeBuilding(1);

            expect(pcm.getProductionState(1)).toBeUndefined();
            expect(pcm.getProductionState(2)).toBeDefined();
        });
    });
});

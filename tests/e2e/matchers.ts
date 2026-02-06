/**
 * Custom Playwright matchers for Settlers.ts e2e tests.
 *
 * Provides domain-specific assertions that work on GamePage instances:
 *   await expect(gp).toHaveEntity({ type: 2, subType: 1 });
 *   await expect(gp).toHaveMode('select');
 *   await expect(gp).toHaveEntityCount(5);
 *   await expect(gp).toHaveBuildingCount(3);
 *
 * These are point-in-time checks. For polling, wrap with expect.toPass():
 *   await expect(async () => {
 *       await expect(gp).toHaveEntityCount(5);
 *   }).toPass({ timeout: 5000 });
 */

import { expect as baseExpect } from '@playwright/test';
import type { GamePage } from './game-page';

export { test } from '@playwright/test';

export interface EntityFilter {
    type?: number;
    subType?: number;
    player?: number;
    x?: number;
    y?: number;
}

export const expect = baseExpect.extend({
    async toHaveEntity(gp: GamePage, filter: EntityFilter) {
        const state = await gp.getGameState();
        const entities = state?.entities ?? [];
        const matching = entities.filter(e => {
            if (filter.type !== undefined && e.type !== filter.type) return false;
            if (filter.subType !== undefined && e.subType !== filter.subType) return false;
            if (filter.player !== undefined && e.player !== filter.player) return false;
            if (filter.x !== undefined && e.x !== filter.x) return false;
            if (filter.y !== undefined && e.y !== filter.y) return false;
            return true;
        });
        return {
            pass: matching.length > 0,
            message: () => matching.length > 0
                ? `expected no entity matching ${JSON.stringify(filter)}, but found ${matching.length}`
                : `expected entity matching ${JSON.stringify(filter)}, but none found among ${entities.length} entities`,
            name: 'toHaveEntity',
            expected: filter,
        };
    },

    async toHaveMode(gp: GamePage, expectedMode: string) {
        const actual = await gp.getDebugField('mode');
        return {
            pass: actual === expectedMode,
            message: () => actual === expectedMode
                ? `expected mode not to be "${expectedMode}"`
                : `expected mode "${expectedMode}", got "${actual}"`,
            name: 'toHaveMode',
            expected: expectedMode,
            actual,
        };
    },

    async toHaveEntityCount(gp: GamePage, expected: number) {
        const actual = await gp.getDebugField('entityCount');
        return {
            pass: actual === expected,
            message: () => actual === expected
                ? `expected entity count not to be ${expected}`
                : `expected ${expected} entities, got ${actual}`,
            name: 'toHaveEntityCount',
            expected,
            actual,
        };
    },

    async toHaveBuildingCount(gp: GamePage, expected: number) {
        const actual = await gp.getDebugField('buildingCount');
        return {
            pass: actual === expected,
            message: () => actual === expected
                ? `expected building count not to be ${expected}`
                : `expected ${expected} buildings, got ${actual}`,
            name: 'toHaveBuildingCount',
            expected,
            actual,
        };
    },
});

/**
 * Custom Playwright matchers for Settlers.ts e2e tests.
 *
 * ## Point-in-time Matchers
 *
 *   await expect(gp).toHaveEntity({ type: 2, subType: 1 });
 *   await expect(gp).toHaveMode('select');
 *   await expect(gp).toHaveEntityCount(5);
 *   await expect(gp).toHaveUnitCount(3);
 *   await expect(gp).toHaveBuildingCount(2);
 *   await expect(gp).toHaveUnitsMoving(1);
 *
 * ## Polling Pattern
 *
 * These are point-in-time checks. For polling, wrap with expect.toPass():
 *
 *   await expect(async () => {
 *       await expect(gp).toHaveUnitCount(5);
 *   }).toPass({ timeout: 5000 });
 *
 * Or use the GamePage polling helpers directly:
 *
 *   await gp.waitForUnitCount(5, 5000);
 *
 * ## Notes
 *
 * - Test map has ~500 environment entities (trees)
 * - Use toHaveUnitCount/toHaveBuildingCount instead of toHaveEntityCount
 *   when checking for "empty" or specific user-placed entity counts
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
    /**
     * Assert that at least one entity matches the given filter.
     */
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

    /**
     * Assert the current game mode.
     */
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

    /**
     * Assert total entity count (includes environment objects like trees).
     * Note: Test map has ~500 trees. Use toHaveUnitCount/toHaveBuildingCount
     * for checking user-placed entities.
     */
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

    /**
     * Assert building count (EntityType.Building = 2).
     */
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

    /**
     * Assert unit count (EntityType.Unit = 1).
     */
    async toHaveUnitCount(gp: GamePage, expected: number) {
        const actual = await gp.getDebugField('unitCount');
        return {
            pass: actual === expected,
            message: () => actual === expected
                ? `expected unit count not to be ${expected}`
                : `expected ${expected} units, got ${actual}`,
            name: 'toHaveUnitCount',
            expected,
            actual,
        };
    },

    /**
     * Assert number of units currently moving.
     */
    async toHaveUnitsMoving(gp: GamePage, expected: number) {
        const actual = await gp.getDebugField('unitsMoving');
        return {
            pass: actual === expected,
            message: () => actual === expected
                ? `expected units moving not to be ${expected}`
                : `expected ${expected} units moving, got ${actual}`,
            name: 'toHaveUnitsMoving',
            expected,
            actual,
        };
    },

    /**
     * Assert no units are moving.
     */
    async toHaveNoUnitsMoving(gp: GamePage) {
        const actual = await gp.getDebugField('unitsMoving');
        return {
            pass: actual === 0,
            message: () => actual === 0
                ? `expected some units to be moving`
                : `expected no units moving, got ${actual}`,
            name: 'toHaveNoUnitsMoving',
            expected: 0,
            actual,
        };
    },

    /**
     * Assert camera is at approximately the given position.
     */
    async toHaveCameraAt(gp: GamePage, expectedX: number, expectedY: number, tolerance = 5) {
        const actualX = await gp.getDebugField('cameraX');
        const actualY = await gp.getDebugField('cameraY');
        const dx = Math.abs(actualX - expectedX);
        const dy = Math.abs(actualY - expectedY);
        const pass = dx <= tolerance && dy <= tolerance;
        return {
            pass,
            message: () => pass
                ? `expected camera not to be at (${expectedX}, ${expectedY})`
                : `expected camera at (${expectedX}, ${expectedY}) ±${tolerance}, got (${actualX}, ${actualY})`,
            name: 'toHaveCameraAt',
            expected: { x: expectedX, y: expectedY },
            actual: { x: actualX, y: actualY },
        };
    },
});

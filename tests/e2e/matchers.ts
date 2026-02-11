/**
 * Custom Playwright matchers for Settlers.ts e2e tests.
 *
 * ## Polling Matchers (Default)
 *
 * All matchers automatically poll until the condition is met or timeout:
 *
 *   await expect(gp).toHaveEntity({ type: 2, subType: 1 });
 *   await expect(gp).toHaveMode('select');
 *   await expect(gp).toHaveUnitCount(3);
 *
 * ## Timeout Control
 *
 * Default timeout is 5s. Override with the second parameter:
 *
 *   await expect(gp).toHaveUnitCount(5, { timeout: 10_000 });
 *
 * ## Point-in-Time Checks
 *
 * For immediate checks without polling, use GamePage.getDebugField() directly:
 *
 *   const count = await gp.getDebugField('unitCount');
 *   expect(count).toBe(5);
 *
 * ## Notes
 *
 * - Test map has ~500 environment entities (trees)
 * - Use toHaveUnitCount/toHaveBuildingCount instead of toHaveEntityCount
 *   when checking for "empty" or specific user-placed entity counts
 */

import { expect as baseExpect } from '@playwright/test';
import type { GamePage } from './game-page';
import { Timeout } from './wait-config';

export { test } from '@playwright/test';

export interface EntityFilter {
    type?: number;
    subType?: number;
    player?: number;
    x?: number;
    y?: number;
}

interface MatcherOptions {
    timeout?: number;
}

const DEFAULT_TIMEOUT = Timeout.DEFAULT;
const POLL_INTERVAL = 100;

export const expect = baseExpect.extend({
    /**
     * Assert that at least one entity matches the given filter.
     * Polls until found or timeout.
     */
    async toHaveEntity(gp: GamePage, filter: EntityFilter, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let lastEntities: Array<{ type: number; subType: number; player: number; x: number; y: number }> = [];

        try {
            await baseExpect.poll(async() => {
                const state = await gp.getGameState();
                lastEntities = state?.entities ?? [];
                const matching = lastEntities.filter(e => {
                    if (filter.type !== undefined && e.type !== filter.type) return false;
                    if (filter.subType !== undefined && e.subType !== filter.subType) return false;
                    if (filter.player !== undefined && e.player !== filter.player) return false;
                    if (filter.x !== undefined && e.x !== filter.x) return false;
                    if (filter.y !== undefined && e.y !== filter.y) return false;
                    return true;
                });
                return matching.length;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected entity matching ${JSON.stringify(filter)}`,
            }).toBeGreaterThan(0);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected entity matching ${JSON.stringify(filter)}, but none found among ${lastEntities.length} entities`,
                name: 'toHaveEntity',
                expected: filter,
            };
        }
    },

    /**
     * Assert the current game mode. Polls until matched or timeout.
     */
    async toHaveMode(gp: GamePage, expectedMode: string, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: string | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('mode');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected mode "${expectedMode}"`,
            }).toBe(expectedMode);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected mode "${expectedMode}", got "${actual}"`,
                name: 'toHaveMode',
                expected: expectedMode,
                actual,
            };
        }
    },

    /**
     * Assert total entity count (includes environment objects like trees).
     * Polls until matched or timeout.
     *
     * Note: Test map has ~500 trees. Use toHaveUnitCount/toHaveBuildingCount
     * for checking user-placed entities.
     */
    async toHaveEntityCount(gp: GamePage, expected: number, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('entityCount');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected ${expected} entities`,
            }).toBe(expected);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected ${expected} entities, got ${actual}`,
                name: 'toHaveEntityCount',
                expected,
                actual,
            };
        }
    },

    /**
     * Assert building count (EntityType.Building = 2).
     * Polls until matched or timeout.
     */
    async toHaveBuildingCount(gp: GamePage, expected: number, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('buildingCount');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected ${expected} buildings`,
            }).toBe(expected);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected ${expected} buildings, got ${actual}`,
                name: 'toHaveBuildingCount',
                expected,
                actual,
            };
        }
    },

    /**
     * Assert unit count (EntityType.Unit = 1).
     * Polls until matched or timeout.
     */
    async toHaveUnitCount(gp: GamePage, expected: number, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('unitCount');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected ${expected} units`,
            }).toBe(expected);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected ${expected} units, got ${actual}`,
                name: 'toHaveUnitCount',
                expected,
                actual,
            };
        }
    },

    /**
     * Assert number of units currently moving.
     * Polls until matched or timeout.
     */
    async toHaveUnitsMoving(gp: GamePage, expected: number, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('unitsMoving');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected ${expected} units moving`,
            }).toBe(expected);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected ${expected} units moving, got ${actual}`,
                name: 'toHaveUnitsMoving',
                expected,
                actual,
            };
        }
    },

    /**
     * Assert at least N units are moving.
     * Polls until matched or timeout.
     */
    async toHaveAtLeastUnitsMoving(gp: GamePage, minExpected: number, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('unitsMoving');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected at least ${minExpected} units moving`,
            }).toBeGreaterThanOrEqual(minExpected);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected at least ${minExpected} units moving, got ${actual}`,
                name: 'toHaveAtLeastUnitsMoving',
                expected: `>= ${minExpected}`,
                actual,
            };
        }
    },

    /**
     * Assert no units are moving.
     * Polls until matched or timeout.
     */
    async toHaveNoUnitsMoving(gp: GamePage, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actual = await gp.getDebugField('unitsMoving');
                return actual;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected no units moving`,
            }).toBe(0);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected no units moving, got ${actual}`,
                name: 'toHaveNoUnitsMoving',
                expected: 0,
                actual,
            };
        }
    },

    /**
     * Assert camera is at approximately the given position.
     * Polls until matched or timeout.
     */
    async toHaveCameraAt(
        gp: GamePage,
        expectedX: number,
        expectedY: number,
        toleranceOrOptions?: number | (MatcherOptions & { tolerance?: number })
    ) {
        const tolerance = typeof toleranceOrOptions === 'number'
            ? toleranceOrOptions
            : toleranceOrOptions?.tolerance ?? 5;
        const timeout = typeof toleranceOrOptions === 'object'
            ? toleranceOrOptions?.timeout ?? DEFAULT_TIMEOUT
            : DEFAULT_TIMEOUT;

        let actualX: number | undefined;
        let actualY: number | undefined;

        try {
            await baseExpect.poll(async() => {
                actualX = await gp.getDebugField('cameraX');
                actualY = await gp.getDebugField('cameraY');
                const dx = Math.abs(actualX - expectedX);
                const dy = Math.abs(actualY - expectedY);
                return dx <= tolerance && dy <= tolerance;
            }, {
                timeout,
                intervals: [POLL_INTERVAL],
                message: `expected camera at (${expectedX}, ${expectedY}) ±${tolerance}`,
            }).toBe(true);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected camera at (${expectedX}, ${expectedY}) ±${tolerance}, got (${actualX}, ${actualY})`,
                name: 'toHaveCameraAt',
                expected: { x: expectedX, y: expectedY },
                actual: { x: actualX, y: actualY },
            };
        }
    },
});

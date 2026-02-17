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
 * For immediate checks without polling, use GamePage.getViewField() directly:
 *
 *   const count = await gp.getViewField('unitCount');
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

// ---------------------------------------------------------------------------
// Factory for view-field polling matchers
// ---------------------------------------------------------------------------

type ApplyAssertion<T> = (poll: any, expected: T) => Promise<void>;

function createViewFieldMatcher<T>(config: {
    field: string;
    describe: (expected: T) => string;
    describeActual?: (actual: T | undefined) => string;
    assert?: ApplyAssertion<T>;
    formatExpected?: (expected: T) => unknown;
}) {
    const describeActual = config.describeActual ?? ((a: T | undefined) => `${a}`);

    return async (gp: GamePage, expected: T, options?: MatcherOptions) => {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: T | undefined;

        try {
            const poll = baseExpect.poll(
                async () => {
                    actual = await gp.getViewField(config.field as any);
                    return actual;
                },
                { timeout, intervals: [POLL_INTERVAL], message: `expected ${config.describe(expected)}` }
            );
            if (config.assert) await config.assert(poll, expected);
            else await poll.toBe(expected);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () => `expected ${config.describe(expected)}, got ${describeActual(actual)}`,
                expected: config.formatExpected ? config.formatExpected(expected) : expected,
                actual,
            };
        }
    };
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

export const expect = baseExpect.extend({
    /**
     * Assert that at least one entity matches the given filter.
     * Polls until found or timeout.
     */
    async toHaveEntity(gp: GamePage, filter: EntityFilter, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let lastEntities: Array<{ type: number; subType: number; player: number; x: number; y: number }> = [];

        try {
            await baseExpect
                .poll(
                    async () => {
                        const state = await gp.actions.getGameState();
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
                    },
                    {
                        timeout,
                        intervals: [POLL_INTERVAL],
                        message: `expected entity matching ${JSON.stringify(filter)}`,
                    }
                )
                .toBeGreaterThan(0);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () =>
                    `expected entity matching ${JSON.stringify(filter)}, but none found among ${lastEntities.length} entities`,
                name: 'toHaveEntity',
                expected: filter,
            };
        }
    },

    /** Assert the current game mode. Polls until matched or timeout. */
    toHaveMode: createViewFieldMatcher<string>({
        field: 'mode',
        describe: m => `mode "${m}"`,
        describeActual: a => `"${a}"`,
    }),

    /**
     * Assert total entity count (includes environment objects like trees).
     *
     * Note: Test map has ~500 trees. Use toHaveUnitCount/toHaveBuildingCount
     * for checking user-placed entities.
     */
    toHaveEntityCount: createViewFieldMatcher<number>({
        field: 'entityCount',
        describe: n => `${n} entities`,
    }),

    /** Assert building count (EntityType.Building = 2). */
    toHaveBuildingCount: createViewFieldMatcher<number>({
        field: 'buildingCount',
        describe: n => `${n} buildings`,
    }),

    /** Assert unit count (EntityType.Unit = 1). */
    toHaveUnitCount: createViewFieldMatcher<number>({
        field: 'unitCount',
        describe: n => `${n} units`,
    }),

    /** Assert number of units currently moving. */
    toHaveUnitsMoving: createViewFieldMatcher<number>({
        field: 'unitsMoving',
        describe: n => `${n} units moving`,
    }),

    /** Assert at least N units are moving. */
    toHaveAtLeastUnitsMoving: createViewFieldMatcher<number>({
        field: 'unitsMoving',
        describe: n => `at least ${n} units moving`,
        assert: (poll, n) => poll.toBeGreaterThanOrEqual(n),
        formatExpected: n => `>= ${n}`,
    }),

    /** Assert no units are moving. */
    async toHaveNoUnitsMoving(gp: GamePage, options?: MatcherOptions) {
        const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        let actual: number | undefined;

        try {
            await baseExpect
                .poll(
                    async () => {
                        actual = await gp.getViewField('unitsMoving');
                        return actual;
                    },
                    { timeout, intervals: [POLL_INTERVAL], message: 'expected no units moving' }
                )
                .toBe(0);

            return { pass: true, message: () => '' };
        } catch {
            return { pass: false, message: () => `expected no units moving, got ${actual}`, expected: 0, actual };
        }
    },

    /** Assert camera is at approximately the given position. */
    async toHaveCameraAt(
        gp: GamePage,
        expectedX: number,
        expectedY: number,
        toleranceOrOptions?: number | (MatcherOptions & { tolerance?: number })
    ) {
        const tolerance =
            typeof toleranceOrOptions === 'number' ? toleranceOrOptions : (toleranceOrOptions?.tolerance ?? 5);
        const timeout =
            typeof toleranceOrOptions === 'object' ? (toleranceOrOptions?.timeout ?? DEFAULT_TIMEOUT) : DEFAULT_TIMEOUT;

        let actualX: number | undefined;
        let actualY: number | undefined;

        try {
            await baseExpect
                .poll(
                    async () => {
                        actualX = await gp.getDebugField('cameraX');
                        actualY = await gp.getDebugField('cameraY');
                        const dx = Math.abs(actualX - expectedX);
                        const dy = Math.abs(actualY - expectedY);
                        return dx <= tolerance && dy <= tolerance;
                    },
                    {
                        timeout,
                        intervals: [POLL_INTERVAL],
                        message: `expected camera at (${expectedX}, ${expectedY}) \u00b1${tolerance}`,
                    }
                )
                .toBe(true);

            return { pass: true, message: () => '' };
        } catch {
            return {
                pass: false,
                message: () =>
                    `expected camera at (${expectedX}, ${expectedY}) \u00b1${tolerance}, got (${actualX}, ${actualY})`,
                name: 'toHaveCameraAt',
                expected: { x: expectedX, y: expectedY },
                actual: { x: actualX, y: actualY },
            };
        }
    },
});

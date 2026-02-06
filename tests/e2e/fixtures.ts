/**
 * Custom Playwright fixture that provides a pre-loaded test map page.
 *
 * The `testMapPage` fixture navigates to ?testMap=true ONCE per worker,
 * then resets game state (removes all entities, resets mode) between tests.
 * This avoids the cost of full page navigation + map loading for every test.
 *
 * Usage:
 *   import { test, expect } from './fixtures';
 *
 *   test('my test', async ({ gp }) => {
 *       // gp is a GamePage with testMap already loaded and state reset
 *       await gp.spawnBearer();
 *       // ...
 *   });
 *
 * Preset fixtures for common starting states:
 *   test('with building', async ({ gpWithBuilding }) => {
 *       // gpWithBuilding has a Lumberjack already placed
 *       const buildings = await gpWithBuilding.getEntities({ type: 2 });
 *       // ...
 *   });
 *
 *   test('with unit', async ({ gpWithUnit }) => {
 *       // gpWithUnit has a Bearer already spawned
 *       const units = await gpWithUnit.getEntities({ type: 1 });
 *       // ...
 *   });
 *
 * Tests that need a completely fresh page (e.g. screenshot baselines)
 * should use the standard `{ page }` fixture instead.
 */

import { test as base, type Page } from '@playwright/test';
import { GamePage } from './game-page';

// Re-export custom matchers so fixture users get them automatically
export { expect } from './matchers';

type TestFixtures = {
    /** GamePage with testMap pre-loaded. State is reset before each test. */
    gp: GamePage;
    /** GamePage with a Lumberjack building already placed. */
    gpWithBuilding: GamePage;
    /** GamePage with a Bearer unit already spawned. */
    gpWithUnit: GamePage;
};

type WorkerFixtures = {
    /** Shared page that persists across all tests in a worker. */
    testMapPage: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
    // Worker-scoped: one page per parallel worker, loaded once
    testMapPage: [async({ browser }, use) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();
        await use(page);
        await context.close();
    }, { scope: 'worker' }],

    // Test-scoped: reset state before each test, provide GamePage
    gp: async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();
        await gp.selectMode();
        // Ensure Buildings tab is selected (may have been changed by previous test)
        await testMapPage.locator('.tab-btn', { hasText: 'Buildings' }).click();
        await gp.waitForFrames(1);
        await use(gp);
    },

    // Preset: reset state + place a Lumberjack building
    gpWithBuilding: async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();
        await gp.selectMode();
        const tile = await gp.findBuildableTile();
        if (tile) {
            await gp.placeBuilding(1, tile.x, tile.y);
        }
        await gp.waitForFrames(2);
        await use(gp);
    },

    // Preset: reset state + spawn a Bearer unit
    gpWithUnit: async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();
        await gp.selectMode();
        await gp.spawnUnit();
        await gp.waitForEntityCountAbove(0);
        await gp.waitForFrames(2);
        await use(gp);
    },
});

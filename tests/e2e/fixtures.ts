import { test as base, type Page } from '@playwright/test';
import { GamePage } from './game-page';

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
 * Tests that need a completely fresh page (e.g. screenshot baselines)
 * should use the standard `{ page }` fixture instead.
 */

type TestFixtures = {
    /** GamePage with testMap pre-loaded. State is reset before each test. */
    gp: GamePage;
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
        await gp.waitForFrames(2);
        await use(gp);
    },
});

export { expect } from '@playwright/test';

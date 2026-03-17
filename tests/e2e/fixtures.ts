/**
 * Custom Playwright fixtures for Settlers.ts e2e tests.
 *
 * ## Fixture Hierarchy
 *
 *   testMapPage (worker-scoped, requires WebGL)
 *       └── gp (test-scoped, 4x speed, game state reset)
 *       └── gpWithUI (adds UI reset: select mode + Buildings tab)
 *   gameStatePage (worker-scoped, no WebGL required)
 *       └── gs (test-scoped, 4x speed, game state reset)
 *   assetPage (worker-scoped, real game assets)
 *       └── gpAssets (skips in CI if assets unavailable)
 *   emptyMapPage (worker-scoped, empty flat map + real assets)
 *       └── gpEmptyMap (skips in CI if assets unavailable)
 *
 * ## Usage
 *
 *   import { test, expect } from './fixtures';
 *
 *   test('my test', async ({ gp }) => {
 *       await gp.actions.spawnUnit('Builder');
 *   });
 *
 * ## Notes
 *
 * - Use `gp` for tests that only use game.execute() APIs (most game logic tests)
 * - Use `gs` for tests that don't need rendering (movement, game state)
 * - Use `gpWithUI` only for tests that need specific UI state
 * - Test map has ~500 environment entities (trees). Use unitCount/buildingCount
 *   assertions, not entityCount, when checking for "empty" state.
 * - For tests needing a fresh page (screenshots), use standard { page } fixture.
 */

import { test as base, type Page } from '@playwright/test';
import { GamePage } from './game-page';
import { Frames, Timeout } from './wait-config';
import { WaitProfiler } from './wait-profiler';

// Re-export custom matchers so fixture users get them automatically
export { expect } from './matchers';

/**
 * Check if WebGL is available in this environment.
 * Set by global-setup.ts after probing browser capabilities.
 */
export function isWebGLAvailable(): boolean {
    return process.env['E2E_WEBGL_AVAILABLE'] !== 'false';
}

/**
 * Check if running in a cloud/CI environment where game assets may not be available.
 * In local environments, asset tests should fail if assets are missing.
 */
export function isCloudEnv(): boolean {
    return process.env['CI'] === 'true' || process.env['CLAUDE_CODE_REMOTE'] === 'true';
}

/** Fixture types for test function signature */
type TestFixtures = {
    /** GamePage with testMap pre-loaded, 4x speed. State is reset before each test. */
    gp: GamePage;
    /** GamePage for game-state-only tests. Works without WebGL. 4x speed. */
    gs: GamePage;
    /** GamePage with UI reset to select mode + Buildings tab (for UI interaction tests). */
    gpWithUI: GamePage;
    /** GamePage with real game assets loaded. Skips in CI if assets unavailable. */
    gpAssets: GamePage;
    /** GamePage on an empty flat map with real sprites. Skips in CI if assets unavailable. */
    gpEmptyMap: GamePage;
};

type WorkerFixtures = {
    /** Shared page that persists across all tests in a worker. Requires WebGL. */
    testMapPage: Page;
    /** Shared page for game-state-only tests. Works without WebGL. */
    gameStatePage: Page;
    /** Shared page with real game assets. Skips in CI if assets unavailable. */
    assetPage: Page;
    /** Shared page with empty flat map + real sprite assets. */
    emptyMapPage: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
    // ─────────────────────────────────────────────────────────────────────────
    // Worker-scoped fixture: one page per parallel worker, loaded once
    // ─────────────────────────────────────────────────────────────────────────
    testMapPage: [
        async ({ browser }, use) => {
            // Fail fast if WebGL is not available (instead of timing out)
            if (!isWebGLAvailable()) {
                throw new Error(
                    'WebGL not available in this environment.\n' +
                        'Tests using gp/testMapPage fixture require WebGL.\n' +
                        'Options:\n' +
                        '  1. Use gs fixture for game-state-only tests (no rendering)\n' +
                        '  2. Run: npx playwright test game-logic --reporter=list\n' +
                        '  3. Set CLAUDE_CODE_REMOTE=true or CI=true to enable SwiftShader\n' +
                        `Detected renderer: ${process.env['E2E_RENDERER'] || 'unknown'}`
                );
            }

            const context = await browser.newContext();
            const page = await context.newPage();
            const gp = new GamePage(page);

            // Navigate and wait for full readiness
            await gp.goto({ testMap: true });
            await gp.wait.waitForReady(Frames.RENDER_SETTLE, Timeout.ASSET_LOAD);

            await use(page);

            // Print profiler summary when worker closes (enabled by default)
            if (WaitProfiler.isEnabled()) {
                // Use compact summary by default, full report with WAIT_PROFILER_VERBOSE=1
                const report =
                    process.env['WAIT_PROFILER_VERBOSE'] === '1'
                        ? WaitProfiler.getReport()
                        : WaitProfiler.getCompactSummary();
                if (report) console.log(report);
            }

            await context.close();
        },
        { scope: 'worker', timeout: Timeout.WORKER_SETUP },
    ],

    // ─────────────────────────────────────────────────────────────────────────
    // Worker-scoped fixture: game-state only (no WebGL required)
    // ─────────────────────────────────────────────────────────────────────────
    gameStatePage: [
        async ({ browser }, use) => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const gp = new GamePage(page);

            // Navigate and wait for game state only (not renderer)
            await gp.goto({ testMap: true });
            await gp.wait.waitForGameReady(5, Timeout.ASSET_LOAD);

            await use(page);

            if (WaitProfiler.isEnabled()) {
                const report =
                    process.env['WAIT_PROFILER_VERBOSE'] === '1'
                        ? WaitProfiler.getReport()
                        : WaitProfiler.getCompactSummary();
                if (report) console.log(report);
            }

            await context.close();
        },
        { scope: 'worker', timeout: Timeout.WORKER_SETUP },
    ],

    // ─────────────────────────────────────────────────────────────────────────
    // Worker-scoped fixture: real game assets (not test map)
    // ─────────────────────────────────────────────────────────────────────────
    assetPage: [
        async ({ browser }, use) => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const gp = new GamePage(page);

            // Bypass cache for large GFX files to avoid ERR_CACHE_WRITE_FAILURE
            await page.route('**/*.gfx', async route => {
                const response = await route.fetch();
                await route.fulfill({
                    response,
                    headers: { ...response.headers(), 'cache-control': 'no-store' },
                });
            });

            // Load real game (not test map)
            await gp.goto({ testMap: false });
            await gp.wait.waitForReady(5, 30_000);

            // Wait for sprites to actually be loaded (happens async after rendererReady)
            await page.waitForFunction(
                () => {
                    const renderer = window.__settlers__?.entityRenderer;
                    return renderer?.spriteManager?.hasSprites === true;
                },
                undefined,
                { timeout: 30_000 }
            );

            await use(page);

            if (!page.isClosed()) {
                await page.unrouteAll({ behavior: 'ignoreErrors' });
            }
            await context.close();
        },
        { scope: 'worker', timeout: 60_000 },
    ],

    // ─────────────────────────────────────────────────────────────────────────
    // Worker-scoped fixture: empty flat map with real sprite assets
    // ─────────────────────────────────────────────────────────────────────────
    emptyMapPage: [
        async ({ browser }, use) => {
            const context = await browser.newContext();
            const page = await context.newPage();
            const gp = new GamePage(page);

            // Bypass cache for large GFX files to avoid ERR_CACHE_WRITE_FAILURE
            await page.route('**/*.gfx', async route => {
                const response = await route.fetch();
                await route.fulfill({
                    response,
                    headers: { ...response.headers(), 'cache-control': 'no-store' },
                });
            });

            // Load empty flat map with real sprite assets
            await gp.goto({ emptyMap: true });
            await gp.wait.waitForReady(5, 30_000);

            // Wait for sprites to actually be loaded (happens async after rendererReady)
            await page.waitForFunction(
                () => {
                    const renderer = window.__settlers__?.entityRenderer;
                    return renderer?.spriteManager?.hasSprites === true;
                },
                undefined,
                { timeout: 30_000 }
            );

            await use(page);

            // Guard teardown against page crash (prevents cascading failures in other tests)
            if (!page.isClosed()) {
                await page.unrouteAll({ behavior: 'ignoreErrors' });
            }
            await context.close();
        },
        { scope: 'worker', timeout: 60_000 },
    ],

    // ─────────────────────────────────────────────────────────────────────────
    // Test-scoped fixtures: reset state before each test
    // ─────────────────────────────────────────────────────────────────────────

    /** Base fixture: minimal reset, clean state, 4x game speed (no UI interaction) */
    gp: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);

            // Reset game state only (removes user entities, keeps environment)
            // No UI clicks - most tests use game.execute() APIs and don't need UI state
            await gp.resetGameState();

            // Use 4x speed by default for faster tests
            await gp.actions.setGameSpeed(4.0);

            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
    ],

    /** Game-state only fixture: works without WebGL. Uses gameStatePage worker fixture. */
    gs: [
        async ({ gameStatePage }, use) => {
            const gp = new GamePage(gameStatePage);
            await gp.resetGameState();
            await gp.actions.setGameSpeed(4.0);
            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
    ],

    /** Fixture with UI reset: select mode + Buildings tab (for UI interaction tests) */
    gpWithUI: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();

            // Reset UI to known state for tests that interact with sidebar
            await testMapPage.keyboard.press('Escape');
            await testMapPage.locator('.tab-btn', { hasText: 'Build' }).click({ force: true });

            await use(gp);
        },
        { timeout: Timeout.LONG_MOVEMENT },
    ],

    /** GamePage with real game assets. Skips in CI if unavailable, fails locally if missing. */
    gpAssets: [
        async ({ assetPage }, use, testInfo) => {
            const gp = new GamePage(assetPage);

            // Check if assets loaded - skip in CI, fail locally
            const hasSprites = await gp.sprites.hasSpritesLoaded();
            if (!hasSprites) {
                if (isCloudEnv()) {
                    testInfo.skip(true, 'CI environment - game assets not available');
                } else {
                    throw new Error(
                        'No sprites loaded. Game assets are required for this test.\n' +
                            'See docs/SETUP.md for asset installation instructions.'
                    );
                }
            }

            await use(gp);
        },
        { timeout: 60_000 },
    ],

    /** GamePage on empty flat map with real sprites. Skips in CI if unavailable, fails locally. */
    gpEmptyMap: [
        async ({ emptyMapPage }, use, testInfo) => {
            const gp = new GamePage(emptyMapPage);

            const hasSprites = await gp.sprites.hasSpritesLoaded();
            if (!hasSprites) {
                if (isCloudEnv()) {
                    testInfo.skip(true, 'CI environment - game assets not available');
                } else {
                    throw new Error(
                        'No sprites loaded. Game assets are required for this test.\n' +
                            'See docs/SETUP.md for asset installation instructions.'
                    );
                }
            }

            // Reset game state (clear any entities from previous test)
            await gp.resetGameState();
            await gp.actions.setGameSpeed(0);

            await use(gp);
        },
        { timeout: 60_000 },
    ],
});

/**
 * Custom Playwright fixtures for Settlers.ts e2e tests.
 *
 * ## Fixture Hierarchy
 *
 *   testMapPage (worker-scoped)
 *       └── gp (test-scoped, game state reset only - fast)
 *           ├── gpWithUI (adds UI reset: select mode + Buildings tab)
 *           ├── gpWithBuilding (has Lumberjack placed)
 *           ├── gpWithUnit (has Carrier spawned)
 *           └── gpWithMovingUnit (has Carrier moving east)
 *
 * ## Usage
 *
 *   import { test, expect } from './fixtures';
 *
 *   // Basic: clean slate with test map loaded (fastest, no UI interaction)
 *   test('my test', async ({ gp }) => {
 *       await gp.actions.spawnUnit(1);
 *   });
 *
 *   // With UI: for tests that interact with sidebar buttons
 *   test('ui test', async ({ gpWithUI }) => {
 *       // UI is reset to select mode + Buildings tab
 *   });
 *
 *   // Preset: building already placed
 *   test('with building', async ({ gpWithBuilding }) => {
 *       const buildings = await gpWithBuilding.actions.getEntities({ type: 2 });
 *   });
 *
 *   // Preset: unit already moving
 *   test('movement test', async ({ gpWithMovingUnit }) => {
 *       // Unit is already moving east - test behavior
 *   });
 *
 * ## Notes
 *
 * - Use `gp` for tests that only use game.execute() APIs (most game logic tests)
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

// Re-export WaitProfiler for manual access in tests
export { WaitProfiler } from './wait-profiler';

/**
 * Check if WebGL is available in this environment.
 * Set by global-setup.ts after probing browser capabilities.
 */
export function isWebGLAvailable(): boolean {
    return process.env.E2E_WEBGL_AVAILABLE !== 'false';
}

/**
 * Check if running on a software renderer (slower, may affect timing).
 */
export function isSoftwareRenderer(): boolean {
    return process.env.E2E_SOFTWARE_RENDERER === 'true';
}

/**
 * Check if running in a cloud/CI environment where game assets may not be available.
 * In local environments, asset tests should fail if assets are missing.
 */
export function isCloudEnv(): boolean {
    return process.env.CI === 'true' || process.env.CLAUDE_CODE_REMOTE === 'true';
}

/** Fixture types for test function signature */
type TestFixtures = {
    /** GamePage with testMap pre-loaded, 4x speed. State is reset before each test. */
    gp: GamePage;
    /** GamePage for game-state-only tests. Works without WebGL. 4x speed. */
    gs: GamePage;
    /** GamePage with 1x speed for timing-sensitive tests (animation observation). */
    gpNormal: GamePage;
    /** GamePage with UI reset to select mode + Buildings tab (for UI interaction tests). */
    gpWithUI: GamePage;
    /** GamePage with a Lumberjack building already placed. */
    gpWithBuilding: GamePage;
    /** GamePage with a Carrier unit already spawned. */
    gpWithUnit: GamePage;
    /** GamePage with a Carrier unit already spawned and moving east. */
    gpWithMovingUnit: GamePage;
    /** GamePage at a specific camera position (center of map). */
    gpCentered: GamePage;
    /** GamePage with 4x game speed for faster movement tests. */
    gpFast: GamePage;
    /** GamePage with real game assets loaded. Skips in CI if assets unavailable. */
    gpAssets: GamePage;
};

type WorkerFixtures = {
    /** Shared page that persists across all tests in a worker. Requires WebGL. */
    testMapPage: Page;
    /** Shared page for game-state-only tests. Works without WebGL. */
    gameStatePage: Page;
    /** Shared page with real game assets. Skips in CI if assets unavailable. */
    assetPage: Page;
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
                        `Detected renderer: ${process.env.E2E_RENDERER || 'unknown'}`
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
                    process.env.WAIT_PROFILER_VERBOSE === '1'
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
                    process.env.WAIT_PROFILER_VERBOSE === '1'
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
                { timeout: 30_000 }
            );

            await use(page);

            await page.unrouteAll({ behavior: 'ignoreErrors' });
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

    /** 1x speed fixture for timing-sensitive tests (animation observation during movement) */
    gpNormal: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();
            await gp.actions.setGameSpeed(1.0);
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
            await testMapPage.locator('[data-testid="btn-select-mode"]').click({ force: true });
            await testMapPage.locator('.tab-btn', { hasText: 'Buildings' }).click({ force: true });

            await use(gp);
        },
        { timeout: Timeout.LONG_MOVEMENT },
    ],

    /** Preset: reset state + place a Lumberjack building */
    gpWithBuilding: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();

            // Place a building at a valid location
            const tile = await gp.actions.findBuildableTile(1);
            if (tile) {
                await gp.actions.placeBuilding(1, tile.x, tile.y);
            }

            // Quick sync - just need one render tick to register the building
            await gp.wait.waitForFrames(Frames.IMMEDIATE, Timeout.FAST);
            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
    ],

    /** Preset: reset state + spawn a Carrier unit */
    gpWithUnit: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();

            // Spawn a carrier at map center
            await gp.actions.spawnUnit(1);

            // Wait for entity to appear
            await gp.wait.waitForUnitCount(1, Timeout.DEFAULT);
            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
    ],

    /** Preset: reset state + spawn a Carrier and start moving east */
    gpWithMovingUnit: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();

            // Spawn and move a unit
            const unit = await gp.actions.spawnUnit(1);
            if (unit) {
                await gp.actions.moveUnit(unit.id, unit.x + 10, unit.y);
                // Wait for movement to start
                await gp.wait.waitForUnitsMoving(1, Timeout.DEFAULT);
            }

            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
    ],

    /** Preset: camera centered on map */
    gpCentered: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();

            // Center camera
            const state = await gp.actions.getGameState();
            if (state) {
                const cx = Math.floor(state.mapWidth / 2);
                const cy = Math.floor(state.mapHeight / 2);
                await gp.moveCamera(cx, cy);
            }

            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
    ],

    /** GamePage with 4x game speed for faster movement tests */
    gpFast: [
        async ({ testMapPage }, use) => {
            const gp = new GamePage(testMapPage);
            await gp.resetGameState();
            await gp.actions.setGameSpeed(4.0);

            await use(gp);
        },
        { timeout: Timeout.MOVEMENT },
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
});

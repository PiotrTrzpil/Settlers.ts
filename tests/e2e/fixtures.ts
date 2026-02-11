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
 *       await gp.spawnUnit(1);
 *   });
 *
 *   // With UI: for tests that interact with sidebar buttons
 *   test('ui test', async ({ gpWithUI }) => {
 *       // UI is reset to select mode + Buildings tab
 *   });
 *
 *   // Preset: building already placed
 *   test('with building', async ({ gpWithBuilding }) => {
 *       const buildings = await gpWithBuilding.getEntities({ type: 2 });
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

// Re-export custom matchers so fixture users get them automatically
export { expect } from './matchers';

/** Fixture types for test function signature */
type TestFixtures = {
    /** GamePage with testMap pre-loaded. State is reset before each test. */
    gp: GamePage;
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
};

type WorkerFixtures = {
    /** Shared page that persists across all tests in a worker. */
    testMapPage: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
    // ─────────────────────────────────────────────────────────────────────────
    // Worker-scoped fixture: one page per parallel worker, loaded once
    // ─────────────────────────────────────────────────────────────────────────
    testMapPage: [async({ browser }, use) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const gp = new GamePage(page);

        // Navigate and wait for full readiness
        await gp.goto({ testMap: true });
        await gp.waitForReady(5, 30_000);

        await use(page);
        await context.close();
    }, { scope: 'worker', timeout: 45_000 }],

    // ─────────────────────────────────────────────────────────────────────────
    // Test-scoped fixtures: reset state before each test
    // ─────────────────────────────────────────────────────────────────────────

    /** Base fixture: minimal reset, clean state (no UI interaction) */
    gp: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);

        // Reset game state only (removes user entities, keeps environment)
        // No UI clicks - most tests use game.execute() APIs and don't need UI state
        await gp.resetGameState();

        await use(gp);
    }, { timeout: 8_000 }],

    /** Fixture with UI reset: select mode + Buildings tab (for UI interaction tests) */
    gpWithUI: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Reset UI to known state for tests that interact with sidebar
        await testMapPage.locator('[data-testid="btn-select-mode"]').click({ force: true });
        await testMapPage.locator('.tab-btn', { hasText: 'Buildings' }).click({ force: true });

        await use(gp);
    }, { timeout: 10_000 }],

    /** Preset: reset state + place a Lumberjack building */
    gpWithBuilding: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Place a building at a valid location
        const tile = await gp.findBuildableTile(1);
        if (tile) {
            await gp.placeBuilding(1, tile.x, tile.y);
        }

        // Quick sync
        await gp.waitForFrames(1, 3_000);
        await use(gp);
    }, { timeout: 8_000 }],

    /** Preset: reset state + spawn a Carrier unit */
    gpWithUnit: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Spawn a carrier at map center
        await gp.spawnUnit(1);

        // Wait for entity to appear
        await gp.waitForUnitCount(1, 5_000);
        await use(gp);
    }, { timeout: 8_000 }],

    /** Preset: reset state + spawn a Carrier and start moving east */
    gpWithMovingUnit: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Spawn and move a unit
        const unit = await gp.spawnUnit(1);
        if (unit) {
            await gp.moveUnit(unit.id, unit.x + 10, unit.y);
            // Wait for movement to start
            await gp.waitForUnitsMoving(1, 5_000);
        }

        await use(gp);
    }, { timeout: 8_000 }],

    /** Preset: camera centered on map */
    gpCentered: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Center camera
        const state = await gp.getGameState();
        if (state) {
            const cx = Math.floor(state.mapWidth / 2);
            const cy = Math.floor(state.mapHeight / 2);
            await gp.moveCamera(cx, cy);
        }

        await use(gp);
    }, { timeout: 8_000 }],
});

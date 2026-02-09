/**
 * Custom Playwright fixtures for Settlers.ts e2e tests.
 *
 * ## Fixture Hierarchy
 *
 *   testMapPage (worker-scoped)
 *       └── gp (test-scoped, minimal reset)
 *           ├── gpWithBuilding (has Lumberjack placed)
 *           ├── gpWithUnit (has Bearer spawned)
 *           └── gpWithMovingUnit (has Bearer moving east)
 *
 * ## Usage
 *
 *   import { test, expect } from './fixtures';
 *
 *   // Basic: clean slate with test map loaded
 *   test('my test', async ({ gp }) => {
 *       await gp.spawnUnit(1);
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
 * - Test map has ~500 environment entities (trees). Use unitCount/buildingCount
 *   assertions, not entityCount, when checking for "empty" state.
 * - Fixture setup uses force:true for UI clicks to skip actionability waits.
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
    /** GamePage with a Lumberjack building already placed. */
    gpWithBuilding: GamePage;
    /** GamePage with a Bearer unit already spawned. */
    gpWithUnit: GamePage;
    /** GamePage with a Bearer unit already spawned and moving east. */
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

    /** Base fixture: minimal reset, clean state */
    gp: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);

        // Reset game state (removes user entities, keeps environment)
        await gp.resetGameState();

        // Quick UI reset with force:true to skip actionability checks
        await testMapPage.locator('[data-testid="btn-select-mode"]').click({ force: true });
        await testMapPage.locator('.tab-btn', { hasText: 'Buildings' }).click({ force: true });

        await use(gp);
    }, { timeout: 5_000 }],

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
        await gp.waitForFrames(1, 2_000);
        await use(gp);
    }, { timeout: 5_000 }],

    /** Preset: reset state + spawn a Bearer unit */
    gpWithUnit: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Spawn a bearer at map center
        await gp.spawnUnit(1);

        // Wait for entity to appear
        await gp.waitForUnitCount(1, 3_000);
        await use(gp);
    }, { timeout: 5_000 }],

    /** Preset: reset state + spawn a Bearer and start moving east */
    gpWithMovingUnit: [async({ testMapPage }, use) => {
        const gp = new GamePage(testMapPage);
        await gp.resetGameState();

        // Spawn and move a unit
        const unit = await gp.spawnUnit(1);
        if (unit) {
            await gp.moveUnit(unit.id, unit.x + 10, unit.y);
            // Wait for movement to start
            await gp.waitForUnitsMoving(1, 3_000);
        }

        await use(gp);
    }, { timeout: 5_000 }],

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
    }, { timeout: 5_000 }],
});

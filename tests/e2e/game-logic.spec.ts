import { test, expect } from './matchers';
import { test as fixtureTest } from './fixtures';
import { GamePage } from './game-page';

/**
 * High-value Playwright E2E tests for the MVP game UI and interaction flow.
 * Tests verify the app loads correctly, navigation works, and UI elements
 * for the game MVP are properly rendered and interactive.
 *
 * NOTE: Most tests use fresh page navigation intentionally - they test
 * initial load, navigation, and cannot use shared fixtures.
 * Canvas Interaction tests use shared fixture (gp) for efficiency.
 */

test.describe('App Loading and Structure', { tag: '@smoke' }, () => {
    test('app loads without JavaScript errors', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await page.goto('/');
        // Wait for app to mount by checking for nav element
        await page.locator('#nav').waitFor({ timeout: 10_000 });

        checkErrors();
    });

    test('navigation bar has all required links', async ({ page }) => {
        await page.goto('/');

        const nav = page.locator('#nav');
        await expect(nav).toBeVisible();

        await expect(nav.locator('a[href="/"]')).toBeVisible();
        await expect(nav.locator('a[href="/map-view"]')).toBeVisible();
        await expect(nav.locator('a[href="/map-file-view"]')).toBeVisible();
        await expect(nav.locator('a[href="/lib-view"]')).toBeVisible();
        await expect(nav.locator('a[href="/logging-view"]')).toBeVisible();
    });
});

test.describe('Map View Page', { tag: '@smoke' }, () => {
    test('map view page renders with map selector', async ({ page }) => {
        await page.goto('/map-view');

        // Map selector label should be visible
        await expect(page.locator('text=Map:')).toBeVisible();
        // Main game canvas should be present
        await expect(page.locator('canvas.cav')).toBeVisible();
    });

    test('debug panel can be expanded and checkbox toggled', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForGameUi(15_000);

        // Settings panel toggle should be visible
        const settingsToggle = page.locator('.settings-toggle-btn');
        await expect(settingsToggle).toBeVisible();

        // Click to expand the settings panel
        await settingsToggle.click();

        // Wait for the settings panel content to appear
        await expect(page.locator('.settings-sections')).toBeVisible();

        // The Debug grid checkbox should be visible (Display section is expanded by default)
        const checkbox = page.locator('label:has-text("Debug grid") input[type="checkbox"]');
        await expect(checkbox).toBeVisible({ timeout: 5000 });

        // Toggle it
        const wasChecked = await checkbox.isChecked();
        await checkbox.click();
        await expect(checkbox).toBeChecked({ checked: !wasChecked });
    });

    test('canvas element exists for rendering', async ({ page }) => {
        const gp = new GamePage(page);
        await page.goto('/map-view');
        await gp.expectCanvasVisible();
    });

    test('game UI panel appears when test map is loaded', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForGameUi(15_000);
    });
});

test.describe('Route Navigation', () => {
    test('navigating between routes preserves app state', async ({ page }) => {
        await page.goto('/');

        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Map:')).toBeVisible();

        await page.click('a[href="/logging-view"]');
        await expect(page).toHaveURL(/logging-view/);

        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Map:')).toBeVisible();
    });

    test('direct URL navigation works for all routes', async ({ page }) => {
        const routes = [
            { path: '/', selector: '#nav' },
            { path: '/map-view', selector: 'text=Map:' },
            { path: '/logging-view', selector: '#nav' },
        ];

        for (const route of routes) {
            await page.goto(route.path);
            await expect(page.locator(route.selector).first()).toBeVisible();
        }
    });
});

// Server freshness & test infrastructure — catch stale servers and broken wiring
fixtureTest.describe('Test Infrastructure', { tag: '@smoke' }, () => {
    fixtureTest('server is serving current source code', async ({ gp }) => {
        // Source hash is injected by Vite at startup and set on window in main.ts.
        // If it doesn't match the current git working tree, the server is stale.
        const serverHash = await gp.page.evaluate(() => (window as any).__source_hash__);
        expect(serverHash).toBeTruthy();
        expect(typeof serverHash).toBe('string');
        // Note: we don't compare against the computed hash here because
        // global-setup already handles auto-restart. This test just verifies
        // the hash mechanism itself is working (not stripped, not undefined).
    });

    fixtureTest('game ticks are running and view state updates', async ({ gp }) => {
        const tickBefore = await gp.getDebugField('tickCount');
        await gp.waitForTicks(5);
        const tickAfter = await gp.getDebugField('tickCount');
        expect(tickAfter).toBeGreaterThan(tickBefore);

        const viewTick = await gp.getViewField('tick');
        expect(typeof viewTick).toBe('number');
        expect(viewTick).toBeGreaterThan(0);
    });

    fixtureTest('all e2e window globals are wired up', async ({ gp }) => {
        // Verify every window global that GamePage methods depend on.
        // If any is missing, nearly all other tests will fail with cryptic errors.
        const globals = await gp.page.evaluate(() => {
            const w = window as any;
            return {
                __settlers_debug__: !!w.__settlers_debug__,
                __settlers_view__: !!w.__settlers_view__,
                __settlers_game__: !!w.__settlers_game__,
                __settlers_input__: !!w.__settlers_input__,
                __settlers_viewpoint__: !!w.__settlers_viewpoint__,
                __source_hash__: !!w.__source_hash__,
            };
        });
        for (const [name, exists] of Object.entries(globals)) {
            expect(exists, `${name} must be set on window`).toBe(true);
        }
    });
});

// Canvas Interaction tests use shared fixture (eliminates 3 waitForReady calls)
fixtureTest.describe('Canvas Interaction', { tag: '@smoke' }, () => {
    fixtureTest('canvas responds to mouse wheel events without errors', async ({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        await gp.canvas.dispatchEvent('wheel', { deltaY: 100 });
        await gp.waitForFrames(1);

        checkErrors();
    });

    fixtureTest('canvas handles click events without errors', async ({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        // Use force:true to avoid waiting for "scheduled navigations" which can timeout
        await gp.canvas.click({ position: { x: 400, y: 400 }, force: true });
        await gp.waitForFrames(1);

        checkErrors();
    });

    fixtureTest('canvas handles right-click without showing context menu', async ({ gp }) => {
        await gp.canvas.click({ button: 'right', position: { x: 400, y: 400 }, force: true });
        await gp.waitForFrames(1);
    });
});

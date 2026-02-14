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

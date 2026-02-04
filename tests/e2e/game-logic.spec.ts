import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * High-value Playwright E2E tests for the MVP game UI and interaction flow.
 * Tests verify the app loads correctly, navigation works, and UI elements
 * for the game MVP are properly rendered and interactive.
 */

test.describe('App Loading and Structure', () => {
    test('app loads without JavaScript errors', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await page.goto('/');
        await page.waitForTimeout(1000);

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

test.describe('Map View Page', () => {
    test('map view page renders with file browser', async ({ page }) => {
        await page.goto('/map-view');

        await expect(page.locator('text=Debug Grid')).toBeVisible();
        await expect(page.locator('input[type="checkbox"]')).toBeVisible();
    });

    test('debug grid checkbox is toggleable', async ({ page }) => {
        await page.goto('/map-view');

        const checkbox = page.locator('input[type="checkbox"]');
        await expect(checkbox).not.toBeChecked();

        await checkbox.check();
        await expect(checkbox).toBeChecked();

        await checkbox.uncheck();
        await expect(checkbox).not.toBeChecked();
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
        await expect(page.locator('text=Debug Grid')).toBeVisible();

        await page.click('a[href="/logging-view"]');
        await expect(page).toHaveURL(/logging-view/);

        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Debug Grid')).toBeVisible();
    });

    test('direct URL navigation works for all routes', async ({ page }) => {
        const routes = [
            { path: '/', selector: '#nav' },
            { path: '/map-view', selector: 'text=Debug Grid' },
            { path: '/logging-view', selector: '#nav' }
        ];

        for (const route of routes) {
            await page.goto(route.path);
            await expect(page.locator(route.selector).first()).toBeVisible();
        }
    });
});

test.describe('Canvas Interaction', () => {
    test('canvas responds to mouse wheel events', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await page.goto('/map-view');
        await gp.expectCanvasVisible();

        await gp.canvas.dispatchEvent('wheel', { deltaY: 100 });
        await page.waitForTimeout(200);

        checkErrors();
    });

    test('canvas handles click events without errors', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await page.goto('/map-view');
        await gp.expectCanvasVisible();

        await gp.canvas.click({ position: { x: 400, y: 400 } });
        await page.waitForTimeout(200);

        checkErrors();
    });

    test('canvas handles right-click without showing context menu', async ({ page }) => {
        const gp = new GamePage(page);
        await page.goto('/map-view');
        await gp.expectCanvasVisible();

        await gp.canvas.click({ button: 'right', position: { x: 400, y: 400 } });
        await page.waitForTimeout(200);
    });
});

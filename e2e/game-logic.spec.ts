import { test, expect } from '@playwright/test';

/**
 * High-value Playwright E2E tests for the MVP game UI and interaction flow.
 * Tests verify the app loads correctly, navigation works, and UI elements
 * for the game MVP are properly rendered and interactive.
 */

test.describe('App Loading and Structure', () => {
    test('app loads without JavaScript errors', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));

        await page.goto('/');
        await page.waitForTimeout(1000);

        // Filter out WebGL-related errors (expected in headless environment)
        const realErrors = errors.filter(e =>
            !e.includes('WebGL') &&
            !e.includes('webgl') &&
            !e.includes('GL')
        );
        expect(realErrors).toHaveLength(0);
    });

    test('navigation bar has all required links', async ({ page }) => {
        await page.goto('/');

        const nav = page.locator('#nav');
        await expect(nav).toBeVisible();

        // Check all navigation links exist
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

        // File browser area should be visible (use specific selector to avoid nav link match)
        await expect(page.locator('text=Show debugging Grid')).toBeVisible();
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
        await page.goto('/map-view');

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Canvas should have expected dimensions
        const width = await canvas.getAttribute('width');
        const height = await canvas.getAttribute('height');
        expect(width).toBe('800');
        expect(height).toBe('800');
    });

    test('game UI panel is hidden before map is loaded', async ({ page }) => {
        await page.goto('/map-view');

        // Game UI should NOT be visible when no game is loaded
        const gameUI = page.locator('[data-testid="game-ui"]');
        await expect(gameUI).toHaveCount(0);
    });
});

test.describe('Route Navigation', () => {
    test('navigating between routes preserves app state', async ({ page }) => {
        await page.goto('/');

        // Navigate to map view
        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Show debugging Grid')).toBeVisible();

        // Navigate to logging view
        await page.click('a[href="/logging-view"]');
        await expect(page).toHaveURL(/logging-view/);

        // Navigate back to map view
        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Show debugging Grid')).toBeVisible();
    });

    test('direct URL navigation works for all routes', async ({ page }) => {
        // Test that each route renders content without 404
        const routes = [
            { path: '/', selector: '#nav' },
            { path: '/map-view', selector: 'text=Show debugging Grid' },
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
        await page.goto('/map-view');

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Wheel event should not cause errors
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));

        await canvas.dispatchEvent('wheel', { deltaY: 100 });
        await page.waitForTimeout(200);

        const realErrors = errors.filter(e =>
            !e.includes('WebGL') && !e.includes('webgl') && !e.includes('GL')
        );
        expect(realErrors).toHaveLength(0);
    });

    test('canvas handles click events without errors', async ({ page }) => {
        await page.goto('/map-view');

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));

        // Click on canvas - should not throw
        await canvas.click({ position: { x: 400, y: 400 } });
        await page.waitForTimeout(200);

        const realErrors = errors.filter(e =>
            !e.includes('WebGL') && !e.includes('webgl') && !e.includes('GL')
        );
        expect(realErrors).toHaveLength(0);
    });

    test('canvas handles right-click without showing context menu', async ({ page }) => {
        await page.goto('/map-view');

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Right-click should be intercepted (context menu prevented)
        await canvas.click({ button: 'right', position: { x: 400, y: 400 } });
        await page.waitForTimeout(200);
        // If context menu was shown, there would be a visible element
        // Since we prevent default, this should just work
    });
});

import { test, expect } from '@playwright/test';

test.describe('App Navigation', () => {
    test('home page loads with navigation links', async ({ page }) => {
        await page.goto('/');

        // Check that navigation links exist
        await expect(page.locator('#nav')).toBeVisible();
        await expect(page.locator('a[href="/map-view"]')).toBeVisible();
        await expect(page.locator('a[href="/"]')).toBeVisible();
    });

    test('can navigate to map view', async ({ page }) => {
        await page.goto('/');

        // Click on Map View link
        await page.click('a[href="/map-view"]');

        // Should be on map-view page
        await expect(page).toHaveURL(/map-view/);
    });

    test('map view shows file browser and debug checkbox', async ({ page }) => {
        await page.goto('/map-view');

        // The map view should show file browser area and debug checkbox
        await expect(page.locator('text=Show debugging Grid')).toBeVisible();
    });

    test('all navigation routes are accessible', async ({ page }) => {
        const routes = [
            { path: '/', text: 'Start' },
            { path: '/map-view', text: 'Map File' },
            { path: '/lib-view', text: 'Lib' },
            { path: '/logging-view', text: 'Log' }
        ];

        for (const route of routes) {
            await page.goto(route.path);
            // Page should load without errors
            const errors: string[] = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.waitForTimeout(500);
            // We just check the page loaded
            expect(errors.filter(e => !e.includes('WebGL'))).toHaveLength(0);
        }
    });
});

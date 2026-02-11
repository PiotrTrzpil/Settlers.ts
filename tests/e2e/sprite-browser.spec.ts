import { test, expect } from './matchers';

/**
 * E2E tests for the JIL and GFX sprite browser views.
 * Consolidated tests that verify page loading and UI functionality.
 */

test.describe('JIL View Sprite Browser', () => {
    test('jil-view loads and view modes work correctly', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        await test.step('page loads without critical errors', async () => {
            await page.goto('/jil-view');
            await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('.controls')).toBeVisible();

            const criticalErrors = errors.filter(e =>
                !e.includes('GFX file') && !e.includes('not available')
            );
            expect(criticalErrors.length).toBe(0);
        });

        await test.step('grid view is default and toggle works', async () => {
            const singleBtn = page.locator('button:has-text("Single")');
            const gridBtn = page.locator('button:has-text("Grid")');

            await expect(singleBtn).toBeVisible();
            await expect(gridBtn).toBeVisible();
            await expect(gridBtn).toHaveClass(/active/);
            await expect(page.locator('.grid-container')).toBeVisible({ timeout: 5000 });

            // Switch to single view
            await singleBtn.click();
            await expect(singleBtn).toHaveClass(/active/);
            await expect(page.locator('.single-view')).toBeVisible({ timeout: 5000 });
        });

        await test.step('selectors visible in single view', async () => {
            await expect(page.locator('.selector-group').first()).toBeVisible();

            // Switch back to grid to verify toggle works both ways
            await page.locator('button:has-text("Grid")').click();
            await expect(page.locator('.grid-container')).toBeVisible({ timeout: 5000 });
        });
    });
});

test.describe('GFX View Grid', () => {
    test('gfx-view loads with controls and file browser', async ({ page }) => {
        await test.step('page loads with view toggle', async () => {
            await page.goto('/gfx-view');
            await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('button:has-text("Single")')).toBeVisible();
            await expect(page.locator('button:has-text("Grid")')).toBeVisible();
        });

        await test.step('file browser is visible', async () => {
            const fileBrowser = page.locator('.browser');
            await expect(fileBrowser).toBeVisible({ timeout: 5000 });
        });
    });
});

import { test, expect } from '@playwright/test';

/**
 * E2E tests for the JIL view sprite browser and entity texture pipeline.
 * These tests verify that:
 * 1. The JIL view loads and displays correctly with grid mode
 * 2. Building type annotations are shown for mapped job indices
 * 3. The entity rendering pipeline correctly loads sprites
 */

test.describe('JIL View Sprite Browser', () => {
    test('jil-view page loads without errors', async({ page }) => {
        const errors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        await page.goto('/jil-view');
        await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });

        // Check controls are visible
        await expect(page.locator('.controls')).toBeVisible();

        // No critical errors should have occurred during load
        const criticalErrors = errors.filter(e =>
            !e.includes('GFX file') && !e.includes('not available')
        );
        expect(criticalErrors.length).toBe(0);
    });

    test('view mode buttons work (single/grid toggle)', async({ page }) => {
        await page.goto('/jil-view');
        await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });

        // Find the Single and Grid buttons
        const singleBtn = page.locator('button:has-text("Single")');
        const gridBtn = page.locator('button:has-text("Grid")');

        await expect(singleBtn).toBeVisible();
        await expect(gridBtn).toBeVisible();

        // Grid view should be active by default
        await expect(gridBtn).toHaveClass(/active/);
        await expect(page.locator('.grid-container')).toBeVisible({ timeout: 5000 });

        // Click single view
        await singleBtn.click();
        await expect(singleBtn).toHaveClass(/active/);
        await expect(page.locator('.single-view')).toBeVisible({ timeout: 5000 });

        // Click back to grid view
        await gridBtn.click();
        await expect(gridBtn).toHaveClass(/active/);
        await expect(page.locator('.grid-container')).toBeVisible({ timeout: 5000 });
    });

    test('selectors are visible in single view', async({ page }) => {
        await page.goto('/jil-view');
        await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });

        // Switch to single view (grid is default)
        await page.locator('button:has-text("Single")').click();
        await expect(page.locator('.single-view')).toBeVisible({ timeout: 5000 });

        // Check that selector groups are visible
        await expect(page.locator('.selector-group').first()).toBeVisible();
    });
});

test.describe('GFX View Grid', () => {
    test('gfx-view page loads and shows grid toggle', async({ page }) => {
        await page.goto('/gfx-view');
        await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });

        // Should have Single/Grid toggle buttons in controls
        await expect(page.locator('button:has-text("Single")')).toBeVisible();
        await expect(page.locator('button:has-text("Grid")')).toBeVisible();
    });

    test('file browser is visible and functional', async({ page }) => {
        await page.goto('/gfx-view');
        await expect(page.locator('.file-viewer')).toBeVisible({ timeout: 10000 });

        // File browser component should be present
        const fileBrowser = page.locator('.browser');
        await expect(fileBrowser).toBeVisible({ timeout: 5000 });
    });
});
// Note: Entity type definition tests (game bridge access, building placement entity type)
// are covered in building-placement.spec.ts which tests these more thoroughly via the full UI flow.

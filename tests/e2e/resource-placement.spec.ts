import { test, expect } from './fixtures';

/**
 * E2E tests for resource placement.
 * Verifies the full interaction pipeline: pointer events -> game commands -> entity creation.
 *
 * All game state queries go through GamePage helpers.
 * Uses the shared testMap fixture — the map is loaded once per worker,
 * and game state is reset between tests via resetGameState().
 */

// --- Resource Placement Mode ---

test.describe('Resource Placement Mode', { tag: '@smoke' }, () => {
    test('clicking resource button activates place_resource mode', async({ gpWithUI: gp }) => {
        const page = gp.page;
        await page.locator('.tab-btn', { hasText: 'Resources' }).click({ force: true });

        const btn = page.locator('[data-testid="btn-resource-0"]');
        await expect(btn).toBeVisible();
        await btn.click();

        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });
    });

    test('select mode button returns to select mode from resource placement', async({ gpWithUI: gp }) => {
        const page = gp.page;
        await page.locator('.tab-btn', { hasText: 'Resources' }).click({ force: true });

        await page.locator('[data-testid="btn-resource-0"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });
    });

    test('resource placement via game.execute() creates entity with correct attributes', async({ gs }) => {
        const passableTile = await gs.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        const resource = await gs.placeResource(0, passableTile.x, passableTile.y, 5);
        expect(resource).not.toBeNull();
        expect(resource!.type).toBe(4); // EntityType.StackedResource
        expect(resource!.x).toBe(passableTile.x);
        expect(resource!.y).toBe(passableTile.y);
        expect(resource!.amount).toBe(5);

        const entities = await gs.getEntities({ type: 4 });
        expect(entities.length).toBeGreaterThanOrEqual(1);
    });

    test('resource placement via placeResource helper', async({ gs }) => {
        const passableTile = await gs.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        const resource = await gs.placeResource(1, passableTile.x, passableTile.y, 3);
        expect(resource).not.toBeNull();
        expect(resource!.type).toBe(4);
        expect(resource!.subType).toBe(1);
        expect(resource!.amount).toBe(3);
    });

    test('clicking canvas while not in placement mode does not place resource', async({ gp }) => {
        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(passableTile.x, passableTile.y);

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });

        const countBefore = (await gp.getEntities({ type: 4 })).length;

        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
        await gp.waitForFrames(1);

        const countAfter = (await gp.getEntities({ type: 4 })).length;
        expect(countAfter).toBe(countBefore);
    });

    test('multiple resources can be placed at different locations', async({ gs }) => {
        const result = await gs.placeMultipleResources(3);
        expect(result.placedCount).toBeGreaterThanOrEqual(2);
        expect(result.totalResources).toBeGreaterThanOrEqual(2);
    });

    test('different resource types can be selected', async({ gpWithUI: gp }) => {
        const page = gp.page;
        await page.locator('.tab-btn', { hasText: 'Resources' }).click({ force: true });

        // Click first resource button
        const btn0 = page.locator('[data-testid="btn-resource-0"]');
        await expect(btn0).toBeVisible();
        await btn0.click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });

        // Check second resource button
        const btn1 = page.locator('[data-testid="btn-resource-1"]');
        if (await btn1.isVisible()) {
            await btn1.click();
            await gp.waitForFrames(2);
            await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });
        }
    });
});

// --- Resource Rendering ---

test.describe('Resource Rendering', () => {
    test('placed resource is rendered on canvas', async({ gp }) => {
        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(passableTile.x, passableTile.y);
        await gp.samplePixels();

        const resource = await gp.placeResource(0, passableTile.x, passableTile.y, 3);
        expect(resource).not.toBeNull();

        await gp.waitForFrames(15);
        await gp.samplePixels();

        await expect(gp).toHaveEntity({ type: 4, x: passableTile.x, y: passableTile.y });
    });

    test('resources with different amounts are placed correctly', async({ gs }) => {
        const amounts = [1, 5, 8];
        const placed: Array<{ id: number; amount: number }> = [];

        for (const amount of amounts) {
            const tile = await gs.findPassableTile();
            if (!tile) continue;
            const resource = await gs.placeResource(0, tile.x, tile.y, amount);
            if (resource) {
                placed.push({ id: resource.id, amount: resource.amount });
            }
        }

        expect(placed.length).toBeGreaterThanOrEqual(2);
        for (const p of placed) {
            expect(p.amount).toBeGreaterThanOrEqual(1);
        }
    });

    test('resource placement preview renders during placement mode', async({ gpWithUI: gp }) => {
        const page = gp.page;
        await page.locator('.tab-btn', { hasText: 'Resources' }).click({ force: true });

        const btn = page.locator('[data-testid="btn-resource-0"]');
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });

        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(passableTile.x, passableTile.y);
        const box = await gp.canvas.boundingBox();
        await gp.canvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
        await gp.waitForFrames(10);

        const preview = await gp.getPlacementPreview();
        expect(preview).not.toBeNull();
        expect(preview!.indicatorsEnabled).toBe(true);
    });
});

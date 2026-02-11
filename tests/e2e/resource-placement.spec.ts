import { test, expect } from './fixtures';

/**
 * E2E tests for resource placement.
 * Verifies the full interaction pipeline: pointer events -> game commands -> entity creation.
 *
 * Uses the shared testMap fixture — the map is loaded once per worker,
 * and game state is reset between tests via resetGameState().
 */

// --- Resource Placement Mode ---

test.describe('Resource Placement Mode', { tag: '@smoke' }, () => {
    test('clicking resource button activates place_resource mode', async({ gp }) => {
        const page = gp.page;

        // Switch to Resources tab
        await page.locator('.tab-btn', { hasText: 'Resources' }).click();

        // Click trunk (wood) resource button
        const btn = page.locator('[data-testid="btn-resource-log"]');
        await expect(btn).toBeVisible();
        await btn.click();

        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });
        await expect(btn).toHaveClass(/active/);
    });

    test('select mode button returns to select mode from resource placement', async({ gp }) => {
        const page = gp.page;

        // Switch to Resources tab and enter resource placement mode
        await page.locator('.tab-btn', { hasText: 'Resources' }).click();
        const btn = page.locator('[data-testid="btn-resource-log"]');
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });

        // Return to select mode
        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });
    });

    test('resource placement via game.execute() creates entity with correct attributes', async({ gp }) => {
        const page = gp.page;

        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        const result = await page.evaluate(({ x, y }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };
            const countBefore = game.state.entities.filter((e: any) => e.type === 4).length; // StackedResource

            const ok = game.execute({
                type: 'place_resource',
                materialType: 0, // LOG (wood)
                amount: 3,
                x, y
            });

            const resources = game.state.entities.filter((e: any) => e.type === 4); // StackedResource
            const newResource = resources[resources.length - 1];
            const resourceState = newResource ? game.state.resourceStates.get(newResource.id) : null;
            return {
                ok,
                countBefore,
                countAfter: resources.length,
                resource: newResource ? {
                    type: newResource.type,
                    subType: newResource.subType,
                    x: newResource.x,
                    y: newResource.y,
                    amount: resourceState?.quantity ?? 1
                } : null,
                expectedPos: { x, y }
            };
        }, passableTile);

        expect(result).not.toHaveProperty('error');
        expect(result.ok).toBe(true);
        expect(result.countAfter).toBeGreaterThan(result.countBefore);
        expect(result.resource).not.toBeNull();
        expect(result.resource!.type).toBe(4); // EntityType.StackedResource
        expect(result.resource!.subType).toBe(0); // EMaterialType.LOG
        expect(result.resource!.x).toBe(result.expectedPos!.x);
        expect(result.resource!.y).toBe(result.expectedPos!.y);
        expect(result.resource!.amount).toBe(3);
    });

    test('resource placement via placeResource helper', async({ gp }) => {
        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        const resource = await gp.placeResource(1, passableTile.x, passableTile.y, 5); // STONE with amount 5

        expect(resource).not.toBeNull();
        expect(resource!.type).toBe(4); // EntityType.StackedResource
        expect(resource!.subType).toBe(1); // EMaterialType.STONE
        expect(resource!.x).toBe(passableTile.x);
        expect(resource!.y).toBe(passableTile.y);
        expect(resource!.amount).toBe(5);
    });

    test('clicking canvas while not in placement mode does not place resource', async({ gp }) => {
        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(passableTile.x, passableTile.y);

        // Ensure we're in select mode
        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });

        const countBefore = await gp.getDebugField('entityCount');

        // Click canvas - should not place a resource
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        // Wait a frame for any potential side effects
        await gp.waitForFrames(1);

        const countAfter = await gp.getDebugField('entityCount');
        expect(countAfter).toBe(countBefore);
    });

    test('multiple resources can be placed at different locations', async({ gp }) => {
        const page = gp.page;

        // Place resources at multiple locations via game.execute to ensure valid spots
        const result = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            let placed = 0;
            const positions: Array<{ x: number; y: number; materialType: number }> = [];

            // Try to place 3 resources in different spots
            for (let r = 0; r < 20 && placed < 3; r++) {
                for (let angle = 0; angle < 8 && placed < 3; angle++) {
                    const dx = Math.round(r * 2 * Math.cos(angle * Math.PI / 4));
                    const dy = Math.round(r * 2 * Math.sin(angle * Math.PI / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;

                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                    const materialType = placed % 3; // Rotate: LOG, STONE, COAL
                    const ok = game.execute({
                        type: 'place_resource',
                        materialType,
                        amount: placed + 1,
                        x: tx, y: ty
                    });

                    if (ok) {
                        placed++;
                        positions.push({ x: tx, y: ty, materialType });
                    }
                }
            }

            return {
                placedCount: placed,
                positions,
                totalResources: game.state.entities.filter((e: any) => e.type === 4).length
            };
        });

        expect(result).not.toHaveProperty('error');
        expect(result.placedCount).toBeGreaterThanOrEqual(2);
    });

    test('different resource types can be selected', async({ gp }) => {
        const page = gp.page;

        // Switch to Resources tab
        await page.locator('.tab-btn', { hasText: 'Resources' }).click();

        // Select trunk (wood)
        await page.locator('[data-testid="btn-resource-log"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });

        // Switch to stone
        const stoneBtn = page.locator('[data-testid="btn-resource-stone"]');
        await expect(stoneBtn).toBeVisible();
        await stoneBtn.click();
        await gp.waitForFrames(2);

        // Should still be in place_resource mode
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource');
        await expect(stoneBtn).toHaveClass(/active/);

        // Trunk button should no longer be active
        const trunkBtn = page.locator('[data-testid="btn-resource-log"]');
        await expect(trunkBtn).not.toHaveClass(/active/);
    });
});

// --- Resource Rendering ---

test.describe('Resource Rendering', () => {
    test('placed resource exists in game state', async({ gp }) => {
        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        const resource = await gp.placeResource(0, passableTile.x, passableTile.y, 4); // LOG with amount 4
        expect(resource).not.toBeNull();

        await gp.waitForFrames(10);

        // Verify resource exists in game state
        await expect(gp).toHaveEntity({ type: 4, x: passableTile.x, y: passableTile.y }); // StackedResource
    });

    test('resource placement preview renders during placement mode', async({ gp }) => {
        const page = gp.page;

        const passableTile = await gp.findPassableTile();
        if (!passableTile) {
            test.skip();
            return;
        }

        await test.step('enter placement mode and hover', async() => {
            await gp.moveCamera(passableTile.x, passableTile.y);

            // Switch to Resources tab
            await page.locator('.tab-btn', { hasText: 'Resources' }).click();

            const btn = page.locator('[data-testid="btn-resource-log"]');
            await expect(btn).toBeVisible();
            await btn.click();
            await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_resource', { timeout: 5000 });

            const box = await gp.canvas.boundingBox();
            await gp.canvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
            await gp.waitForFrames(10);
        });

        await test.step('verify placement preview is active', async() => {
            await expect(gp).toHaveMode('place_resource');

            const indicatorState = await page.evaluate(() => {
                const renderer = (window as any).__settlers_entity_renderer__;
                if (!renderer) return null;
                return {
                    indicatorsEnabled: renderer.buildingIndicatorsEnabled,
                    previewMaterialType: renderer.previewMaterialType,
                    placementPreview: renderer.placementPreview ? {
                        entityType: renderer.placementPreview.entityType,
                        subType: renderer.placementPreview.subType,
                    } : null,
                };
            });

            expect(indicatorState).not.toBeNull();
            expect(indicatorState!.indicatorsEnabled).toBe(true);
            // Check the unified placementPreview
            expect(indicatorState!.placementPreview).not.toBeNull();
            expect(indicatorState!.placementPreview!.entityType).toBe('resource');
            expect(indicatorState!.placementPreview!.subType).toBeGreaterThanOrEqual(0);
        });
    });
});

// --- Resource Amount Parameter ---

test.describe('Resource Amount', () => {
    test('resource amount input changes placement amount', async({ gp }) => {
        const page = gp.page;

        // Switch to Resources tab
        await page.locator('.tab-btn', { hasText: 'Resources' }).click();

        // Find the amount input and verify it exists
        const amountInput = page.locator('.amount-input');
        await expect(amountInput).toBeVisible();

        // Change amount to 7
        await amountInput.fill('7');
        await expect(amountInput).toHaveValue('7');
    });

    test('resources placed with different amounts have correct values', async({ gp }) => {
        const page = gp.page;

        // Place resources with different amounts via game.execute
        const result = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            const amounts = [1, 4, 8];
            const placed: Array<{ amount: number; actualAmount: number }> = [];

            for (let i = 0; i < amounts.length; i++) {
                const tx = cx + i * 3;
                const ty = cy;

                if (tx >= w) continue;

                const ok = game.execute({
                    type: 'place_resource',
                    materialType: 0, // LOG
                    amount: amounts[i],
                    x: tx, y: ty
                });

                if (ok) {
                    const resources = game.state.entities.filter((e: any) => e.type === 4);
                    const lastResource = resources[resources.length - 1];
                    const resourceState = lastResource ? game.state.resourceStates.get(lastResource.id) : null;
                    placed.push({
                        amount: amounts[i],
                        actualAmount: resourceState?.quantity ?? 0
                    });
                }
            }

            return { placed };
        });

        expect(result).not.toHaveProperty('error');
        expect(result.placed).toBeDefined();
        expect(result.placed!.length).toBeGreaterThan(0);

        for (const r of result.placed!) {
            expect(r.actualAmount).toBe(r.amount);
        }
    });
});

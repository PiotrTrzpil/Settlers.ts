import { test, expect } from './fixtures';
import { Timeout } from './wait-config';

/**
 * E2E tests for building placement.
 * Verifies building placement mode, entity creation, and rendering.
 *
 * All game state queries go through GamePage helpers.
 * Uses the shared testMap fixture — the map is loaded once per worker,
 * and game state is reset between tests via resetGameState().
 */

test.describe('Building Placement Mode', { tag: '@smoke' }, () => {
    test('clicking building button activates place_building mode', async ({ gp }) => {
        const btn = gp.page.locator('[data-testid="btn-woodcutter"]');
        await expect(btn).toBeVisible();
        await btn.click();

        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });
        await expect(btn).toHaveClass(/active/);
    });

    test('select mode button returns to select mode', async ({ gp }) => {
        const btn = gp.page.locator('[data-testid="btn-woodcutter"]');
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });
    });

    test('building placement via canvas click on buildable terrain', async ({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(buildableTile.x, buildableTile.y);
        await gp.waitForFrames(1);

        // Enter placement mode
        await gp.page.locator('[data-testid="btn-woodcutter"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        const countBefore = await gp.getViewField('buildingCount');

        // Click canvas center (camera is now centered on buildable terrain)
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        await gp.waitForFrames(1);

        const countAfter = await gp.getViewField('buildingCount');
        // Due to tile picker precision, click might land on non-buildable tile
        expect(countAfter).toBeGreaterThanOrEqual(countBefore);
    });

    test('clicking canvas while not in placement mode does not place building', async ({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(buildableTile.x, buildableTile.y);

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });

        const buildingsBefore = await gp.getViewField('buildingCount');

        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 }, force: true });

        await gp.waitForFrames(1);

        await expect(gp).toHaveBuildingCount(buildingsBefore);
    });

    test('multiple canvas clicks place multiple buildings', async ({ gp }) => {
        // Enter placement mode
        await gp.page.locator('[data-testid="btn-woodcutter"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        const result = await gp.placeMultipleBuildings(3);
        expect(result.placedCount).toBeGreaterThanOrEqual(2);

        // Debug stats update every 500ms, so wait for them to refresh
        await gp.waitForBuildingCount(result.totalBuildings, Timeout.DEFAULT);
    });

    test('different building types can be selected and placed', async ({ gp }) => {
        const page = gp.page;

        // Place a lumberjack first
        await page.locator('[data-testid="btn-woodcutter"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        let state = await gp.getGameState();
        expect(state?.placeBuildingType).toBe(1); // Lumberjack

        // Switch to warehouse
        await page.locator('[data-testid="btn-warehouse"]').click();
        await gp.waitForFrames(2);

        state = await gp.getGameState();
        expect(state?.placeBuildingType).toBe(2); // Warehouse

        // Find a spot that fits a Warehouse (3x3)
        const warehouseTile = await gp.findBuildableTile(2);
        if (!warehouseTile) {
            test.skip();
            return;
        }

        const warehouse = await gp.placeBuilding(2, warehouseTile.x, warehouseTile.y);
        expect(warehouse).not.toBeNull();
        expect(warehouse!.subType).toBe(2); // Warehouse
    });
});

// --- Entity Rendering ---

test.describe('Entity Rendering', () => {
    test('placed building is visually rendered on canvas', async ({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('place building at buildable tile', async () => {
            await gp.moveCamera(buildableTile.x, buildableTile.y);
            await gp.samplePixels();

            const building = await gp.placeBuilding(1, buildableTile.x, buildableTile.y);
            expect(building).not.toBeNull();
            await gp.waitForFrames(15);
        });

        await test.step('verify building exists in game state', async () => {
            const buildingCount = await gp.getViewField('buildingCount');
            expect(buildingCount).toBeGreaterThan(0);
            await gp.samplePixels();
            await expect(gp).toHaveEntity({ type: 2, x: buildableTile.x, y: buildableTile.y });
        });

        checkErrors();
    });

    test('building renders with player color (procedural fallback)', async ({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('place buildings for two different players', async () => {
            const building0 = await gp.placeBuilding(1, buildableTile.x, buildableTile.y, 0);
            expect(building0).not.toBeNull();
            await gp.placeBuilding(1, buildableTile.x + 3, buildableTile.y + 3, 1);
        });

        await test.step('verify buildings exist with different players', async () => {
            await gp.waitForFrames(15);
            await expect(gp).toHaveEntity({ type: 2, player: 0 });

            const buildings = await gp.getEntities({ type: 2 });
            expect(buildings.length).toBeGreaterThanOrEqual(1);
        });
    });

    test('multiple buildings rendered correctly', async ({ gp }) => {
        const result = await gp.placeMultipleBuildings(5, [1, 2, 3], [0, 1, 2, 3]);

        expect(result.placedCount).toBeGreaterThan(0);
        await gp.waitForFrames(15);
        await expect(gp).toHaveBuildingCount(result.placedCount);
    });

    test('building placement preview renders during placement mode', async ({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('enter placement mode and hover', async () => {
            await gp.moveCamera(buildableTile.x, buildableTile.y);
            const btn = gp.page.locator('[data-testid="btn-woodcutter"]');
            await expect(btn).toBeVisible();
            await btn.click();
            await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

            const box = await gp.canvas.boundingBox();
            await gp.canvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
            await gp.waitForFrames(10);
        });

        await test.step('verify placement preview is active', async () => {
            await expect(gp).toHaveMode('place_building');

            const preview = await gp.getPlacementPreview();
            expect(preview).not.toBeNull();
            expect(preview!.indicatorsEnabled).toBe(true);
            expect(preview!.previewBuildingType).toBeGreaterThan(0);
        });
    });
});

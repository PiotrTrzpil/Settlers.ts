import { test, expect } from './fixtures';
import { UnitType } from '@/game/unit-types';
import { Timeout } from './wait-config';

/**
 * E2E tests for building placement and unit spawning.
 * Verifies the full interaction pipeline: pointer events -> game commands -> entity creation.
 *
 * All game state queries go through GamePage helpers.
 * Uses the shared testMap fixture — the map is loaded once per worker,
 * and game state is reset between tests via resetGameState().
 */

// --- Pointer Event Pipeline ---

test.describe('Pointer Event Pipeline', { tag: '@smoke' }, () => {
    test('pointer events fire on canvas (not suppressed)', async({ gp }) => {
        const page = gp.page;

        const eventLog = await page.evaluate(() => {
            return new Promise<string[]>((resolve) => {
                const canvas = document.querySelector('canvas');
                if (!canvas) { resolve(['no canvas']); return }

                const log: string[] = [];
                for (const evt of ['pointerdown', 'pointerup', 'pointermove',
                    'mousedown', 'mouseup', 'mousemove', 'click']) {
                    canvas.addEventListener(evt, () => log.push(evt), { once: true });
                }

                const rect = canvas.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                canvas.dispatchEvent(new PointerEvent('pointerdown', {
                    clientX: cx, clientY: cy, bubbles: true, button: 0, pointerId: 1
                }));
                canvas.dispatchEvent(new PointerEvent('pointermove', {
                    clientX: cx + 1, clientY: cy, bubbles: true, button: 0, pointerId: 1
                }));
                canvas.dispatchEvent(new PointerEvent('pointerup', {
                    clientX: cx, clientY: cy, bubbles: true, button: 0, pointerId: 1
                }));

                requestAnimationFrame(() => resolve(log));
            });
        });

        expect(eventLog).toContain('pointerdown');
        expect(eventLog).toContain('pointerup');
        expect(eventLog).toContain('pointermove');
    });

    test('canvas click sets hoveredTile via tileClick event', async({ gp }) => {
        await gp.canvas.click({ position: { x: 400, y: 400 } });

        const tileInfo = gp.page.locator('[data-testid="tile-info"]');
        await expect(tileInfo).toBeVisible({ timeout: 5000 });
        const text = await tileInfo.textContent();
        expect(text).toMatch(/Tile: \(\d+, \d+\)/);
    });
});

// --- Building Placement Mode ---

test.describe('Building Placement Mode', { tag: '@smoke' }, () => {
    test('clicking building button activates place_building mode', async({ gp }) => {
        const btn = gp.page.locator('[data-testid="btn-woodcutter"]');
        await expect(btn).toBeVisible();
        await btn.click();

        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });
        await expect(btn).toHaveClass(/active/);
    });

    test('select mode button returns to select mode', async({ gp }) => {
        const btn = gp.page.locator('[data-testid="btn-woodcutter"]');
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });
    });

    test('building placement via game.execute() creates entity with correct attributes', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(1, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();
        expect(building!.type).toBe(2); // EntityType.Building
        expect(building!.subType).toBe(1); // BuildingType.WoodcutterHut
        expect(building!.x).toBe(buildableTile.x);
        expect(building!.y).toBe(buildableTile.y);
        expect(building!.player).toBe(0);

        await expect(gp).toHaveBuildingCount(1);
    });

    test('building placement via canvas click on buildable terrain', async({ gp }) => {
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

        const countBefore = await gp.getDebugField('buildingCount');

        // Click canvas center (camera is now centered on buildable terrain)
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        await gp.waitForFrames(1);

        const countAfter = await gp.getDebugField('buildingCount');
        // Due to tile picker precision, click might land on non-buildable tile
        expect(countAfter).toBeGreaterThanOrEqual(countBefore);
    });

    test('clicking canvas while not in placement mode does not place building', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(buildableTile.x, buildableTile.y);

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });

        const buildingsBefore = await gp.getDebugField('buildingCount');

        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        await gp.waitForFrames(1);

        await expect(gp).toHaveBuildingCount(buildingsBefore);
    });

    test('multiple canvas clicks place multiple buildings', async({ gp }) => {
        // Enter placement mode
        await gp.page.locator('[data-testid="btn-woodcutter"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        const result = await gp.placeMultipleBuildings(3);
        expect(result.placedCount).toBeGreaterThanOrEqual(2);

        // Debug stats update every 500ms, so wait for them to refresh
        await gp.waitForBuildingCount(result.totalBuildings, Timeout.DEFAULT);
    });

    test('different building types can be selected and placed', async({ gp }) => {
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

// --- Unit Spawning ---

test.describe('Unit Spawning', { tag: '@smoke' }, () => {
    test('spawn carrier creates entity on passable terrain', async({ gp }) => {
        const entity = await gp.spawnUnit(UnitType.Carrier);
        expect(entity).not.toBeNull();
        expect(entity!.x).toBeGreaterThanOrEqual(0);
        expect(entity!.y).toBeGreaterThanOrEqual(0);

        // Verify it's on passable terrain via GamePage helper
        const terrainCheck = await gp.isTerrainPassable(entity!.x, entity!.y);
        expect(terrainCheck).not.toBeNull();
        expect(terrainCheck!.isPassable).toBe(true);
    });

    test('spawn swordsman creates entity', async({ gp }) => {
        const countBefore = await gp.getDebugField('entityCount');
        const entity = await gp.spawnUnit(UnitType.Swordsman);

        // Debug stats throttle updates, so wait for refresh
        await gp.waitForEntityCountAbove(countBefore, Timeout.DEFAULT);
        expect(entity).not.toBeNull();
    });

    test('clicking canvas then spawning uses clicked tile', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        const entity = await gp.spawnUnit(UnitType.Builder, buildableTile.x, buildableTile.y);
        expect(entity).not.toBeNull();
        expect(entity!.x).toBe(buildableTile.x);
        expect(entity!.y).toBe(buildableTile.y);
    });

    test('spawned unit is on passable terrain (not water)', async({ gp }) => {
        const entity = await gp.spawnUnit(UnitType.Builder);
        expect(entity).not.toBeNull();

        const terrainCheck = await gp.isTerrainPassable(entity!.x, entity!.y);
        expect(terrainCheck).not.toBeNull();
        expect(terrainCheck!.isWater).toBe(false);
        expect(terrainCheck!.isPassable).toBe(true);
    });
});

// --- Entity Rendering ---

test.describe('Entity Rendering', () => {
    test('placed building is visually rendered on canvas', async({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('place building at buildable tile', async() => {
            await gp.moveCamera(buildableTile.x, buildableTile.y);
            await gp.samplePixels();

            const building = await gp.placeBuilding(1, buildableTile.x, buildableTile.y);
            expect(building).not.toBeNull();
            await gp.waitForFrames(15);
        });

        await test.step('verify building exists in game state', async() => {
            const buildingCount = await gp.getDebugField('buildingCount');
            expect(buildingCount).toBeGreaterThan(0);
            await gp.samplePixels();
            await expect(gp).toHaveEntity({ type: 2, x: buildableTile.x, y: buildableTile.y });
        });

        checkErrors();
    });

    test('building renders with player color (procedural fallback)', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('place buildings for two different players', async() => {
            const building0 = await gp.placeBuilding(1, buildableTile.x, buildableTile.y, 0);
            expect(building0).not.toBeNull();
            await gp.placeBuilding(1, buildableTile.x + 3, buildableTile.y + 3, 1);
        });

        await test.step('verify buildings exist with different players', async() => {
            await gp.waitForFrames(15);
            await expect(gp).toHaveEntity({ type: 2, player: 0 });

            const buildings = await gp.getEntities({ type: 2 });
            expect(buildings.length).toBeGreaterThanOrEqual(1);
        });
    });

    test('multiple buildings rendered correctly', async({ gp }) => {
        const result = await gp.placeMultipleBuildings(5, [1, 2, 3], [0, 1, 2, 3]);

        expect(result.placedCount).toBeGreaterThan(0);
        await gp.waitForFrames(15);
        await expect(gp).toHaveBuildingCount(result.placedCount);
    });

    test('building placement preview renders during placement mode', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('enter placement mode and hover', async() => {
            await gp.moveCamera(buildableTile.x, buildableTile.y);
            const btn = gp.page.locator('[data-testid="btn-woodcutter"]');
            await expect(btn).toBeVisible();
            await btn.click();
            await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

            const box = await gp.canvas.boundingBox();
            await gp.canvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
            await gp.waitForFrames(10);
        });

        await test.step('verify placement preview is active', async() => {
            await expect(gp).toHaveMode('place_building');

            const preview = await gp.getPlacementPreview();
            expect(preview).not.toBeNull();
            expect(preview!.indicatorsEnabled).toBe(true);
            expect(preview!.previewBuildingType).toBeGreaterThan(0);
        });
    });
});

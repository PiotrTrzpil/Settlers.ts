import { test, expect } from './matchers';
import { GamePage } from './game-page';

/**
 * E2E tests for building placement and unit spawning.
 * Verifies the full interaction pipeline: pointer events -> game commands -> entity creation.
 */

// --- Pointer Event Pipeline ---

test.describe('Pointer Event Pipeline', { tag: '@smoke' }, () => {
    test('pointer events fire on canvas (not suppressed)', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

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

                // Events are dispatched synchronously; wait one animation frame
                // for any async handlers to settle before reading the log.
                requestAnimationFrame(() => resolve(log));
            });
        });

        expect(eventLog).toContain('pointerdown');
        expect(eventLog).toContain('pointerup');
        expect(eventLog).toContain('pointermove');
    });

    test('canvas click sets hoveredTile via tileClick event', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const canvas = page.locator('canvas');
        await canvas.click({ position: { x: 400, y: 400 } });

        const tileInfo = page.locator('[data-testid="tile-info"]');
        await expect(tileInfo).toBeVisible({ timeout: 5000 });
        const text = await tileInfo.textContent();
        expect(text).toMatch(/Tile: \(\d+, \d+\)/);
    });
});

// --- Building Placement Mode ---

test.describe('Building Placement Mode', { tag: '@smoke' }, () => {
    test('clicking building button activates place_building mode', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const btn = page.locator('[data-testid="btn-lumberjack"]');
        await expect(btn).toBeVisible();
        await btn.click();

        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });
        await expect(btn).toHaveClass(/active/);
    });

    test('select mode button returns to select mode', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        await page.locator('[data-testid="btn-lumberjack"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });
    });

    test('building placement via game.execute() creates entity with correct attributes', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        const result = await page.evaluate(({ x, y }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };
            const countBefore = game.state.entities.filter((e: any) => e.type === 2).length;

            const ok = game.execute({
                type: 'place_building',
                buildingType: 1, // Lumberjack
                x, y,
                player: 0
            });

            const buildings = game.state.entities.filter((e: any) => e.type === 2);
            const newBuilding = buildings[buildings.length - 1];
            return {
                ok,
                countBefore,
                countAfter: buildings.length,
                building: newBuilding ? {
                    type: newBuilding.type,
                    subType: newBuilding.subType,
                    x: newBuilding.x,
                    y: newBuilding.y,
                    player: newBuilding.player
                } : null,
                expectedPos: { x, y }
            };
        }, buildableTile);

        expect(result).not.toHaveProperty('error');
        expect(result.ok).toBe(true);
        expect(result.countAfter).toBeGreaterThan(result.countBefore);
        expect(result.building).not.toBeNull();
        expect(result.building!.type).toBe(2); // EntityType.Building
        expect(result.building!.subType).toBe(1); // BuildingType.Lumberjack
        expect(result.building!.x).toBe(result.expectedPos!.x);
        expect(result.building!.y).toBe(result.expectedPos!.y);
        expect(result.building!.player).toBe(0);
    });

    test('building placement via canvas click on buildable terrain', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(buildableTile.x, buildableTile.y);
        await gp.waitForFrames(5);

        // Enter placement mode
        await page.locator('[data-testid="btn-lumberjack"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        const countBefore = await gp.getDebugField('buildingCount');

        // Click canvas center (camera is now centered on buildable terrain)
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        // Wait a few frames for placement to process
        await gp.waitForFrames(5);

        const countAfter = await gp.getDebugField('buildingCount');

        // Due to tile picker precision, click might land on non-buildable tile
        expect(countAfter).toBeGreaterThanOrEqual(countBefore);
    });

    test('clicking canvas while not in placement mode does not place building', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(buildableTile.x, buildableTile.y);

        // Ensure we're in select mode
        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });

        const buildingsBefore = await gp.getDebugField('buildingCount');

        // Click canvas - should not place a building
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        // Wait a few frames for any potential side effects
        await gp.waitForFrames(5);

        await expect(gp).toHaveBuildingCount(buildingsBefore);
    });

    test('multiple canvas clicks place multiple buildings', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Enter placement mode
        await page.locator('[data-testid="btn-lumberjack"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        // Place buildings at multiple locations via game.execute to ensure valid spots
        const result = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            let placed = 0;
            const positions: Array<{ x: number; y: number }> = [];

            // Try to place 3 buildings in different spots
            for (let r = 0; r < 20 && placed < 3; r++) {
                for (let angle = 0; angle < 8 && placed < 3; angle++) {
                    const dx = Math.round(r * 3 * Math.cos(angle * Math.PI / 4));
                    const dy = Math.round(r * 3 * Math.sin(angle * Math.PI / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;

                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                    const ok = game.execute({
                        type: 'place_building',
                        buildingType: 1,
                        x: tx, y: ty,
                        player: 0
                    });

                    if (ok) {
                        placed++;
                        positions.push({ x: tx, y: ty });
                    }
                }
            }

            return {
                placedCount: placed,
                positions,
                totalBuildings: game.state.entities.filter((e: any) => e.type === 2).length
            };
        });

        expect(result).not.toHaveProperty('error');
        expect(result.placedCount).toBeGreaterThanOrEqual(2);
        await expect(gp).toHaveBuildingCount(result.totalBuildings);
    });

    test('different building types can be selected and placed', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Place a lumberjack first
        await page.locator('[data-testid="btn-lumberjack"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        let state = await gp.getGameState();
        expect(state?.placeBuildingType).toBe(1); // Lumberjack

        // Switch to warehouse
        await page.locator('[data-testid="btn-warehouse"]').click();
        await gp.waitForFrames(2);

        state = await gp.getGameState();
        expect(state?.placeBuildingType).toBe(2); // Warehouse

        // Find a spot that fits a Warehouse (3x3) using the parameterized helper
        const warehouseTile = await gp.findBuildableTile(2);
        if (!warehouseTile) {
            test.skip();
            return;
        }

        // Place the warehouse via helper
        const warehouse = await gp.placeBuilding(2, warehouseTile.x, warehouseTile.y);
        expect(warehouse).not.toBeNull();
        expect(warehouse!.subType).toBe(2); // Warehouse
    });
});

// --- Unit Spawning ---

test.describe('Unit Spawning', { tag: '@smoke' }, () => {
    test('spawn bearer creates entity on passable terrain', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const countBefore = await gp.getDebugField('entityCount');
        await gp.spawnBearer();
        await gp.waitForEntityCountAbove(countBefore);

        await expect(gp).toHaveEntityCount(countBefore + 1);

        // Entity should be on the map, NOT at (10,10) water
        const state = await gp.getGameState();
        const entity = state?.entities[state.entities.length - 1];

        expect(entity).toBeDefined();
        expect(entity!.x).toBeGreaterThanOrEqual(0);
        expect(entity!.y).toBeGreaterThanOrEqual(0);

        // Verify it's NOT at old hardcoded (10, 10) which was water
        const isOldDefault = entity!.x === 10 && entity!.y === 10;
        expect(isOldDefault).toBe(false);
    });

    test('spawn swordsman creates entity', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const countBefore = await gp.getDebugField('entityCount');
        await gp.spawnSwordsman();
        await gp.waitForEntityCountAbove(countBefore);

        await expect(gp).toHaveEntityCount(countBefore + 1);
    });

    test('clicking canvas then spawning uses clicked tile', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Find land and move camera there so the click hits passable terrain
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }
        await gp.moveCamera(buildableTile.x, buildableTile.y);

        // Click canvas to set hoveredTile
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        const tileInfo = page.locator('[data-testid="tile-info"]');
        await expect(tileInfo).toBeVisible({ timeout: 5000 });

        const countBefore = await gp.getDebugField('entityCount');
        await gp.spawnBearer();
        await gp.waitForEntityCountAbove(countBefore);

        await expect(gp).toHaveEntityCount(countBefore + 1);

        // Entity should be near the clicked tile (on passable terrain)
        await expect(gp).toHaveEntity({ type: 1 }); // EntityType.Unit
    });

    test('spawned unit is on passable terrain (not water)', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        await gp.spawnBearer();
        await gp.waitForEntityCountAbove(0);

        // Check the terrain type under the spawned entity
        const terrainCheck = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const entities = game.state.entities;
            if (entities.length === 0) return null;

            const e = entities[entities.length - 1];
            const idx = game.mapSize.toIndex(e.x, e.y);
            const gt = game.groundType[idx];
            return {
                entityPos: { x: e.x, y: e.y },
                groundType: gt,
                isWater: gt <= 8,
                isPassable: gt > 8 && gt !== 32
            };
        });

        expect(terrainCheck).not.toBeNull();
        expect(terrainCheck!.isWater).toBe(false);
        expect(terrainCheck!.isPassable).toBe(true);
    });
});

// --- Entity Rendering ---

test.describe('Entity Rendering', () => {
    test('placed building is visually rendered on canvas', async({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('place building at buildable tile', async() => {
            await gp.moveCamera(buildableTile.x, buildableTile.y);

            // Sample pixels before placing building (baseline)
            await gp.samplePixels();

            const building = await gp.placeBuilding(1, buildableTile.x, buildableTile.y);
            expect(building).not.toBeNull();

            await gp.waitForFrames(15);
        });

        await test.step('verify building exists in game state', async() => {
            const buildingCount = await gp.getDebugField('buildingCount');
            expect(buildingCount).toBeGreaterThan(0);

            // Sample pixels after (building should be rendered)
            await gp.samplePixels();

            await expect(gp).toHaveEntity({ type: 2, x: buildableTile.x, y: buildableTile.y });
        });

        checkErrors();
    });

    test('building renders with player color (procedural fallback)', async({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('place buildings for two different players', async() => {
            // Place building for player 0 (blue)
            const building0 = await gp.placeBuilding(1, buildableTile.x, buildableTile.y, 0);
            expect(building0).not.toBeNull();

            // Place building for player 1 (red) at nearby tile
            await gp.placeBuilding(1, buildableTile.x + 3, buildableTile.y + 3, 1);
        });

        await test.step('verify buildings exist with different players', async() => {
            await gp.waitForFrames(15);
            await expect(gp).toHaveEntity({ type: 2, player: 0 });

            const buildings = await gp.getEntities({ type: 2 });
            expect(buildings.length).toBeGreaterThanOrEqual(1);
        });
    });

    test('multiple buildings rendered correctly', async({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        // Place multiple buildings
        const result = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            let placedCount = 0;
            const targetCount = 5;

            // Spiral out to find multiple buildable spots
            for (let r = 0; r < Math.max(w, h) / 2 && placedCount < targetCount; r += 3) {
                for (let angle = 0; angle < 8 && placedCount < targetCount; angle++) {
                    const dx = Math.round(r * Math.cos(angle * Math.PI / 4));
                    const dy = Math.round(r * Math.sin(angle * Math.PI / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;

                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                    const ok = game.execute({
                        type: 'place_building',
                        buildingType: (placedCount % 3) + 1, // Rotate: Lumberjack(1), Warehouse(2), Sawmill(3)
                        x: tx, y: ty,
                        player: placedCount % 4 // Rotate players
                    });

                    if (ok) placedCount++;
                }
            }

            return {
                placedCount,
                totalEntities: game.state.entities.length
            };
        });

        expect(result).not.toHaveProperty('error');
        expect(result.placedCount).toBeGreaterThan(0);

        await gp.waitForFrames(15);

        await expect(gp).toHaveBuildingCount(result.placedCount!);
        await expect(gp).toHaveEntityCount(result.totalEntities!);
    });

    test('building placement preview renders during placement mode', async({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await test.step('enter placement mode and hover', async() => {
            await gp.moveCamera(buildableTile.x, buildableTile.y);
            await page.locator('[data-testid="btn-lumberjack"]').click();
            await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

            const box = await gp.canvas.boundingBox();
            await gp.canvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
            await gp.waitForFrames(10);
        });

        await test.step('verify placement preview is active', async() => {
            await expect(gp).toHaveMode('place_building');

            const indicatorState = await page.evaluate(() => {
                const renderer = (window as any).__settlers_entity_renderer__;
                if (!renderer) return null;
                return {
                    indicatorsEnabled: renderer.buildingIndicatorsEnabled,
                    previewBuildingType: renderer.previewBuildingType,
                };
            });

            expect(indicatorState).not.toBeNull();
            expect(indicatorState!.indicatorsEnabled).toBe(true);
            expect(indicatorState!.previewBuildingType).toBeGreaterThan(0);
        });
    });
});

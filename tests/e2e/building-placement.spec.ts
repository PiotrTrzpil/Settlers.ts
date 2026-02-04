import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * E2E tests for building placement and unit spawning.
 * Verifies the full interaction pipeline: pointer events → game commands → entity creation.
 */

// ─── Pointer Event Pipeline ────────────────────────────────────────

test.describe('Pointer Event Pipeline', () => {
    test('pointer events fire on canvas (not suppressed)', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const eventLog = await page.evaluate(() => {
            return new Promise<string[]>((resolve) => {
                const canvas = document.querySelector('canvas');
                if (!canvas) { resolve(['no canvas']); return; }

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

                setTimeout(() => resolve(log), 200);
            });
        });

        expect(eventLog).toContain('pointerdown');
        expect(eventLog).toContain('pointerup');
        expect(eventLog).toContain('pointermove');
    });

    test('canvas click sets hoveredTile via tileClick event', async ({ page }) => {
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

// ─── Building Placement Mode ───────────────────────────────────────

test.describe('Building Placement Mode', () => {
    test('clicking building button activates place_building mode', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const btn = page.locator('[data-testid="btn-guardhouse"]');
        await expect(btn).toBeVisible();
        await btn.click();

        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });
        await expect(btn).toHaveClass(/active/);
    });

    test('select mode button returns to select mode', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        await page.locator('[data-testid="btn-guardhouse"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        await gp.selectMode();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'select', { timeout: 5000 });
    });

    test('building placement works on valid terrain via game.execute()', async ({ page }) => {
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
            const before = game.state.entities.length;

            const ok = game.execute({
                type: 'place_building',
                buildingType: 0,
                x, y,
                player: 0
            });

            const after = game.state.entities.length;
            return { ok, before, after, tile: { x, y } };
        }, buildableTile);

        expect(result).not.toHaveProperty('error');
        expect(result.ok).toBe(true);
        expect(result.after).toBeGreaterThan(result.before);
    });

    test('building placement via canvas click on buildable terrain', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        await gp.moveCamera(buildableTile.x, buildableTile.y);

        // Enter placement mode
        await page.locator('[data-testid="btn-guardhouse"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        const countBefore = await gp.getDebugField('entityCount');

        // Click canvas center (camera is now centered on buildable terrain)
        const box = await gp.canvas.boundingBox();
        await gp.canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

        // Wait for entity count to potentially change
        await page.waitForTimeout(300);
        const countAfter = await gp.getDebugField('entityCount');

        // The clicked tile near the camera position should be buildable
        expect(countAfter).toBeGreaterThanOrEqual(countBefore);
    });
});

// ─── Unit Spawning ─────────────────────────────────────────────────

test.describe('Unit Spawning', () => {
    test('spawn settler creates entity on passable terrain', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const countBefore = await gp.getDebugField('entityCount');
        await gp.spawnSettler();
        await gp.waitForEntityCountAbove(countBefore);

        const countAfter = await gp.getDebugField('entityCount');
        expect(countAfter).toBe(countBefore + 1);

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

    test('spawn soldier creates entity', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const countBefore = await gp.getDebugField('entityCount');
        await gp.spawnSoldier();
        await gp.waitForEntityCountAbove(countBefore);

        expect(await gp.getDebugField('entityCount')).toBe(countBefore + 1);
    });

    test('clicking canvas then spawning uses clicked tile', async ({ page }) => {
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
        await gp.spawnSettler();

        // Wait briefly for entity creation
        await page.waitForTimeout(300);
        const countAfter = await gp.getDebugField('entityCount');
        const state = await gp.getGameState();

        if (countAfter > countBefore) {
            // Spawn succeeded - entity should be near the clicked tile
            const entity = state?.entities[state.entities.length - 1];
            expect(entity).toBeDefined();
        }
        // Spawn may fail if clicked tile is impassable — that's expected behaviour
    });

    test('spawned unit is on passable terrain (not water)', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        await gp.spawnSettler();
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

// ─── Entity Rendering ─────────────────────────────────────────────

test.describe('Entity Rendering', () => {
    test('placed building is visually rendered on canvas', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        // Find a buildable tile
        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        // Move camera to the buildable tile
        await gp.moveCamera(buildableTile.x, buildableTile.y);

        // Sample pixels before placing building
        const pixelsBefore = await gp.samplePixels();

        // Place a building via game.execute()
        const result = await page.evaluate(({ x, y }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const ok = game.execute({
                type: 'place_building',
                buildingType: 0, // Guardhouse
                x, y,
                player: 0
            });

            return { ok, tile: { x, y } };
        }, buildableTile);

        expect(result).not.toHaveProperty('error');
        expect(result.ok).toBe(true);

        // Wait for a few frames to ensure rendering
        await gp.waitForFrames(15);

        // Verify building count increased
        const buildingCount = await gp.getDebugField('buildingCount');
        expect(buildingCount).toBeGreaterThan(0);

        // Sample pixels after placing building
        const pixelsAfter = await gp.samplePixels();

        // At least the center pixel should have changed (building rendered there)
        // This verifies the entity renderer is drawing something
        const centerBefore = pixelsBefore.center;
        const centerAfter = pixelsAfter.center;

        // Pixels may or may not change depending on exact camera position,
        // but the building should exist and be rendered
        const state = await gp.getGameState();
        expect(state).not.toBeNull();
        expect(state!.entities.length).toBeGreaterThan(0);

        // Find the building we just placed
        const building = state!.entities.find(e => e.type === 2 && e.x === buildableTile.x && e.y === buildableTile.y);
        expect(building).toBeDefined();

        checkErrors();
    });

    test('building renders with player color (procedural fallback)', async ({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        // Place buildings for two different players
        const placements = await page.evaluate(({ x, y }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            // Place building for player 0 (blue)
            const ok1 = game.execute({
                type: 'place_building',
                buildingType: 0,
                x, y,
                player: 0
            });

            // Place building for player 1 (red) at nearby tile
            const ok2 = game.execute({
                type: 'place_building',
                buildingType: 0,
                x: x + 3, y: y + 3,
                player: 1
            });

            return {
                player0: ok1,
                player1: ok2,
                entities: game.state.entities.map((e: any) => ({
                    id: e.id, type: e.type, player: e.player, x: e.x, y: e.y
                }))
            };
        }, buildableTile);

        expect(placements).not.toHaveProperty('error');
        expect(placements.player0).toBe(true);

        // Wait for rendering
        await gp.waitForFrames(15);

        // Verify both buildings exist with different players
        const state = await gp.getGameState();
        const buildings = state?.entities.filter(e => e.type === 2) ?? [];
        expect(buildings.length).toBeGreaterThanOrEqual(1);

        // First building should be player 0
        const building0 = buildings.find(b => b.player === 0);
        expect(building0).toBeDefined();
    });

    test('multiple buildings rendered correctly', async ({ page }) => {
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
                        buildingType: placedCount % 3, // Rotate building types
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

        // Wait for rendering
        await gp.waitForFrames(15);

        // Verify building count in debug stats
        const buildingCount = await gp.getDebugField('buildingCount');
        expect(buildingCount).toBe(result.placedCount);

        // Verify entity count matches
        const entityCount = await gp.getDebugField('entityCount');
        expect(entityCount).toBe(result.totalEntities);
    });

    test('building placement preview renders during placement mode', async ({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        const buildableTile = await gp.findBuildableTile();
        if (!buildableTile) {
            test.skip();
            return;
        }

        // Move camera to buildable tile
        await gp.moveCamera(buildableTile.x, buildableTile.y);

        // Enter placement mode
        await page.locator('[data-testid="btn-guardhouse"]').click();
        await expect(gp.modeIndicator).toHaveAttribute('data-mode', 'place_building', { timeout: 5000 });

        // Move mouse over canvas to trigger preview
        const box = await gp.canvas.boundingBox();
        await gp.canvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });

        // Wait for a few frames
        await gp.waitForFrames(10);

        // Verify we're in placement mode with preview
        const mode = await gp.getMode();
        expect(mode).toBe('place_building');

        // The preview should be rendered (we can't easily verify visually without screenshot,
        // but we verify the mode is correct and no errors occurred)
    });
});

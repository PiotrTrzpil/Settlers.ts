import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * E2E screenshot regression test for terrain rendering.
 *
 * Loads a synthetic test map (via ?testMap=true) that contains every major
 * terrain type arranged in horizontal bands with height variation.
 * Takes a screenshot of the rendered WebGL canvas and compares it against
 * a checked-in baseline image.
 *
 * The test map uses procedural fallback textures (no Settlers 4 game assets
 * required), so different terrain types appear as different colors.
 */

test.describe('Terrain Rendering', () => {
    test('renders all terrain types and matches baseline screenshot', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);
        await gp.expectCanvasVisible();

        // Verify the debug bridge reports sane state
        const debug = await gp.getDebug();
        expect(debug.gameLoaded).toBe(true);
        expect(debug.rendererReady).toBe(true);
        expect(debug.canvasWidth).toBeGreaterThan(0);

        // Screenshot comparison — toHaveScreenshot auto-waits for stability
        await expect(gp.canvas).toHaveScreenshot('terrain-all-types.png');

        checkErrors();
    });

    test('terrain map info shows synthetic label', async ({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady();

        const mapInfo = page.locator('.map-info-pre');
        await expect(mapInfo).toContainText('Test map');
    });

    test('entity count starts at zero on fresh test map', async ({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // data-* attribute assertion — no text parsing needed
        await expect(gp.entityCount).toHaveAttribute('data-count', '0');

        // Cross-check via debug bridge
        const count = await gp.getDebugField('entityCount');
        expect(count).toBe(0);
    });

    test('mode defaults to select', async ({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady();

        expect(await gp.getMode()).toBe('select');
        expect(await gp.getDebugField('mode')).toBe('select');
    });
});

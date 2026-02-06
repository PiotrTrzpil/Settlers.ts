import { test, expect } from './matchers';
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

test.describe('Terrain Rendering', { tag: '@screenshot' }, () => {
    test('renders all terrain types and matches baseline screenshot', async({ page }) => {
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

    test('test map loads with correct initial state', { tag: '@smoke' }, async({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Debug bridge reports game loaded and renderer ready
        const debug = await gp.getDebug();
        expect(debug.gameLoaded).toBe(true);
        expect(debug.rendererReady).toBe(true);

        // Entity count starts at zero on fresh test map
        await expect(gp.entityCount).toHaveAttribute('data-count', '0');
        await expect(gp).toHaveEntityCount(0);

        // Mode defaults to select
        await expect(gp).toHaveMode('select');
    });
});

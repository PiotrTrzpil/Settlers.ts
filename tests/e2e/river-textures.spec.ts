import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * E2E test for river texture configuration debugging.
 *
 * Loads a real map (NOT testMap) to use actual game textures, then cycles
 * through all 48 possible river texture configurations (6 slot permutations
 * × 8 flip combos). Takes a screenshot of each configuration for visual comparison.
 *
 * IMPORTANT: Requires game assets (2.gh6 texture file and .map files) to be
 * available in the file manager. Without them, this test won't show meaningful
 * differences between configurations.
 *
 * Run with: npx playwright test river-textures --headed
 * Screenshots are saved to tests/e2e/.results/river-configs/
 */

test.describe('River Textures', () => {
    // This test cycles through 48 configurations and takes screenshots - needs longer timeout
    test('cycle through all 48 river configurations with real textures', async({ page }) => {
        test.setTimeout(180000); // 3 minutes for 48 screenshots
        const gp = new GamePage(page);

        // Load WITHOUT testMap flag to use real textures
        await gp.goto({ testMap: false });
        await gp.waitForReady(10, 60000); // longer timeout for real map loading
        await gp.expectCanvasVisible();

        // Find a river area by searching the map for River terrain types (96-99)
        const riverLocation = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const groundType = game.groundType;
            const mapSize = game.mapSize;
            const w = mapSize.width;
            const h = mapSize.height;

            // River types: River1=96, River2=97, River3=98, River4=99
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = mapSize.toIndex(x, y);
                    const type = groundType[idx];
                    if (type >= 96 && type <= 99) {
                        return { x, y, type };
                    }
                }
            }
            return null;
        });

        if (riverLocation) {
            console.log(`Found river at (${riverLocation.x}, ${riverLocation.y}) type=${riverLocation.type}`);
            await gp.moveCamera(riverLocation.x, riverLocation.y);
        } else {
            console.log('No river found in map, using default position');
            await gp.moveCamera(100, 100);
        }
        await gp.waitForFrames(5);

        // Get references to debug controls
        const debug = await gp.getDebug();
        expect(debug.gameLoaded).toBe(true);

        // Cycle through all 48 configurations
        for (let perm = 0; perm < 6; perm++) {
            for (let flipBits = 0; flipBits < 8; flipBits++) {
                const flipInner = (flipBits & 4) !== 0;
                const flipOuter = (flipBits & 2) !== 0;
                const flipMiddle = (flipBits & 1) !== 0;

                // Apply the configuration via the debug bridge
                await page.evaluate(({ p, fi, fo, fm }) => {
                    const lr = (window as any).__settlers_landscape__;
                    if (lr) {
                        lr.rebuildRiverTextures({
                            slotPermutation: p,
                            flipInner: fi,
                            flipOuter: fo,
                            flipMiddle: fm,
                        });
                    }
                }, { p: perm, fi: flipInner, fo: flipOuter, fm: flipMiddle });

                // Wait for render to complete
                await gp.waitForFrames(3);

                // Take screenshot with descriptive name
                const configIdx = perm * 8 + flipBits + 1;
                const flipStr = `${flipInner ? 'I' : '-'}${flipOuter ? 'O' : '-'}${flipMiddle ? 'M' : '-'}`;
                const filename = `river-config-${String(configIdx).padStart(2, '0')}-perm${perm}-${flipStr}.png`;

                await gp.canvas.screenshot({
                    path: `tests/e2e/.results/river-configs/${filename}`
                });

                console.log(`Screenshot ${configIdx}/48: perm=${perm} flips=${flipStr}`);
            }
        }
    });

    test('river area renders without errors', async({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        // Load real map with actual textures
        await gp.goto({ testMap: false });
        await gp.waitForReady(10, 60000);

        // Move around to see some terrain
        await gp.moveCamera(100, 100);
        await gp.waitForFrames(10);

        // Basic render sanity check
        const pixels = await gp.samplePixels();
        expect(pixels.center).toBeDefined();

        // Ensure no JS errors
        checkErrors();
    });
});

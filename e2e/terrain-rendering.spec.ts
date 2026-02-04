import { test, expect } from '@playwright/test';

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
        const errors: string[] = [];
        const consoleLogs: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

        await page.goto('/map-view?testMap=true');

        // Wait for the game UI to appear (indicates game is loaded and rendering)
        await page.waitForSelector('[data-testid="game-ui"]', { timeout: 20000 });

        // Give the renderer time to initialise textures and draw several frames
        await page.waitForTimeout(2000);

        // Take a screenshot of just the canvas element
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // --- Debug diagnostics ---
        const debugInfo = await page.evaluate(() => {
            const c = document.querySelector('canvas');
            if (!c) return { error: 'no canvas found' };

            const rect = c.getBoundingClientRect();
            const gl = c.getContext('webgl2');

            // Sample pixels from various spots on the canvas
            const pixels: Record<string, number[]> = {};
            if (gl) {
                const spots = {
                    center: [Math.floor(c.width / 2), Math.floor(c.height / 2)],
                    topLeft: [10, 10],
                    topRight: [c.width - 10, 10],
                    bottomLeft: [10, c.height - 10],
                    bottomRight: [c.width - 10, c.height - 10],
                };
                for (const [name, [x, y]] of Object.entries(spots)) {
                    const buf = new Uint8Array(4);
                    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
                    pixels[name] = Array.from(buf);
                }
            }

            return {
                canvasWidth: c.width,
                canvasHeight: c.height,
                clientWidth: c.clientWidth,
                clientHeight: c.clientHeight,
                boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                hasWebGL2: !!gl,
                devicePixelRatio: window.devicePixelRatio,
                pixels,
            };
        });
        console.log('=== CANVAS DEBUG INFO ===');
        console.log(JSON.stringify(debugInfo, null, 2));
        console.log('=== CONSOLE LOGS FROM PAGE ===');
        consoleLogs.forEach(l => console.log(l));
        console.log('=== END DEBUG ===');

        const screenshot = await canvas.screenshot();
        expect(screenshot).toMatchSnapshot('terrain-all-types.png');

        // Verify no unexpected JS errors (WebGL texture warnings are expected)
        const unexpectedErrors = errors.filter(
            e => !e.includes('2.gh6') && !e.includes('WebGL') && !e.includes('texture')
        );
        expect(unexpectedErrors).toHaveLength(0);
    });

    test('terrain map info shows synthetic label', async ({ page }) => {
        await page.goto('/map-view?testMap=true');

        await page.waitForSelector('[data-testid="game-ui"]', { timeout: 20000 });

        const mapInfo = page.locator('.map-info-pre');
        await expect(mapInfo).toContainText('Test map');
    });
});

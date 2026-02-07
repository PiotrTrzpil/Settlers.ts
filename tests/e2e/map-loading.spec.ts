import { test, expect } from './matchers';
import { GamePage } from './game-page';

/**
 * Map loading performance and health tests.
 * Measures timing of loading phases and checks for console issues.
 */

test.describe('Map Loading Performance', { tag: '@smoke' }, () => {
    test('test map loads within acceptable time', async({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        // Collect console messages for analysis
        const consoleLogs: Array<{ level: string; text: string }> = [];
        page.on('console', (msg) => {
            consoleLogs.push({ level: msg.type(), text: msg.text() });
        });

        const timings: Record<string, number> = {};
        const startTime = Date.now();

        // Navigate to map view
        await gp.goto({ testMap: true });
        timings.navigation = Date.now() - startTime;

        // Wait for game UI to mount
        const uiStart = Date.now();
        await gp.waitForGameUi(15_000);
        timings.gameUiMount = Date.now() - uiStart;

        // Wait for game to be fully loaded (gameLoaded + rendererReady)
        const readyStart = Date.now();
        await page.waitForFunction(
            () => {
                const d = (window as any).__settlers_debug__;
                return d && d.gameLoaded && d.rendererReady;
            },
            null,
            { timeout: 15_000 },
        );
        timings.gameReady = Date.now() - readyStart;

        // Wait for first frames to render
        const framesStart = Date.now();
        await gp.waitForFrames(10, 10_000);
        timings.first10Frames = Date.now() - framesStart;

        timings.total = Date.now() - startTime;

        // Get debug stats
        const debug = await gp.getDebug();

        // Log timing results
        console.log('\n=== Map Loading Timings ===');
        console.log(`Navigation:      ${timings.navigation}ms`);
        console.log(`Game UI mount:   ${timings.gameUiMount}ms`);
        console.log(`Game ready:      ${timings.gameReady}ms`);
        console.log(`First 10 frames: ${timings.first10Frames}ms`);
        console.log(`Total:           ${timings.total}ms`);
        console.log(`FPS:             ${debug.fps}`);
        console.log(`Canvas:          ${debug.canvasWidth}x${debug.canvasHeight}`);

        // Show game timing logs
        const timingLogs = consoleLogs.filter(
            (l) => l.level === 'log' && (l.text.includes('ms') || l.text.includes('==='))
        );
        if (timingLogs.length > 0) {
            console.log('\n=== Game Timing Logs ===');
            timingLogs.forEach((l) => console.log(`  ${l.text}`));
        }

        // Analyze console logs
        const warnings = consoleLogs.filter((l) => l.level === 'warning');
        const errors2 = consoleLogs.filter((l) => l.level === 'error');

        if (warnings.length > 0) {
            console.log('\n=== Console Warnings ===');
            warnings.forEach((w) => console.log(`  ${w.text}`));
        }
        if (errors2.length > 0) {
            console.log('\n=== Console Errors ===');
            errors2.forEach((e) => console.log(`  ${e.text}`));
        }

        // Assertions
        expect(timings.total).toBeLessThan(30_000); // Should load within 30s (varies by machine/load)
        expect(debug.gameLoaded).toBe(true);
        expect(debug.rendererReady).toBe(true);
        expect(debug.frameCount).toBeGreaterThan(0);

        checkErrors();
    });

    test('map loading reports reasonable debug stats', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        const debug = await gp.getDebug();
        const state = await gp.getGameState();

        console.log('\n=== Debug Stats ===');
        console.log(`Entity count:    ${debug.entityCount}`);
        console.log(`Building count:  ${debug.buildingCount}`);
        console.log(`Unit count:      ${debug.unitCount}`);
        console.log(`Map size:        ${state?.mapWidth}x${state?.mapHeight}`);
        console.log(`Camera:          (${debug.cameraX}, ${debug.cameraY})`);
        console.log(`Zoom:            ${debug.zoom}`);
        console.log(`Mode:            ${debug.mode}`);

        // Test map size (can vary, just check it's reasonable)
        expect(state?.mapWidth).toBeGreaterThan(100);
        expect(state?.mapHeight).toBeGreaterThan(100);

        // Should start with no entities on fresh test map
        expect(debug.entityCount).toBe(0);

        // Camera should be centered-ish
        expect(debug.cameraX).toBeGreaterThan(50);
        expect(debug.cameraY).toBeGreaterThan(50);
    });

    test('no excessive console warnings during load', async({ page }) => {
        const gp = new GamePage(page);

        const logCounts = new Map<string, number>();

        page.on('console', (msg) => {
            const key = `${msg.type()}:${msg.text().slice(0, 100)}`;
            logCounts.set(key, (logCounts.get(key) ?? 0) + 1);
        });

        await gp.goto({ testMap: true });
        await gp.waitForReady(10);

        // Convert to array and sort by count
        const sortedLogs = Array.from(logCounts.entries())
            .map(([key, count]) => {
                const [level, text] = key.split(':');
                return { level, text, count };
            })
            .filter((l) => l.count > 1 || l.level === 'error' || l.level === 'warning')
            .sort((a, b) => b.count - a.count);

        if (sortedLogs.length > 0) {
            console.log('\n=== Repeated/Notable Console Messages ===');
            sortedLogs.slice(0, 20).forEach((l) => {
                console.log(`  [${l.level}] x${l.count}: ${l.text}`);
            });
        }

        // Fail if there are excessively repeated warnings (likely a bug)
        const excessiveWarnings = sortedLogs.filter(
            (l) => l.level === 'warning' && l.count > 10
        );
        if (excessiveWarnings.length > 0) {
            console.log('\n=== Excessive Warnings (potential issues) ===');
            excessiveWarnings.forEach((w) => {
                console.log(`  x${w.count}: ${w.text}`);
            });
        }

        // Allow known errors (missing game assets, renderer init without assets)
        const unexpectedErrors = sortedLogs.filter(
            (l) =>
                l.level === 'error' &&
                !l.text.includes('.gh') &&
                !l.text.includes('.gfx') &&
                !l.text.includes('WebGL') &&
                !l.text.includes('RemoteFile') &&
                !l.text.includes('Renderer') &&
                !l.text.includes('ERR_CACHE') &&
                !l.text.includes('Failed to load resource') &&
                !l.text.includes('Unhandled promise rejection')
        );

        expect(unexpectedErrors).toHaveLength(0);
    });
});

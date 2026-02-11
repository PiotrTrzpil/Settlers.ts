import { test, expect } from './matchers';
import { GamePage } from './game-page';

/**
 * Map loading performance and health tests.
 * Consolidated test that measures timing, checks stats, and verifies console health.
 */

test.describe('Map Loading', { tag: '@smoke' }, () => {
    test('test map loads with good performance and no warnings', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        // Collect console messages for analysis
        const consoleLogs: Array<{ level: string; text: string }> = [];
        const logCounts = new Map<string, number>();

        page.on('console', (msg) => {
            consoleLogs.push({ level: msg.type(), text: msg.text() });
            const key = `${msg.type()}:${msg.text().slice(0, 100)}`;
            logCounts.set(key, (logCounts.get(key) ?? 0) + 1);
        });

        const timings: Record<string, number> = {};
        const startTime = Date.now();

        await test.step('navigate and wait for game ready', async () => {
            await gp.goto({ testMap: true });
            timings.navigation = Date.now() - startTime;

            const uiStart = Date.now();
            await gp.waitForGameUi(15_000);
            timings.gameUiMount = Date.now() - uiStart;

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

            const framesStart = Date.now();
            await gp.waitForFrames(10, 10_000);
            timings.first10Frames = Date.now() - framesStart;
            timings.total = Date.now() - startTime;
        });

        await test.step('verify timing is acceptable', async () => {
            const debug = await gp.getDebug();

            console.log('\n=== Map Loading Timings ===');
            console.log(`Navigation:      ${timings.navigation}ms`);
            console.log(`Game UI mount:   ${timings.gameUiMount}ms`);
            console.log(`Game ready:      ${timings.gameReady}ms`);
            console.log(`First 10 frames: ${timings.first10Frames}ms`);
            console.log(`Total:           ${timings.total}ms`);
            console.log(`FPS:             ${debug.fps}`);

            expect(timings.total).toBeLessThan(30_000);
            expect(debug.gameLoaded).toBe(true);
            expect(debug.rendererReady).toBe(true);
            expect(debug.frameCount).toBeGreaterThan(0);
        });

        await test.step('verify debug stats are reasonable', async () => {
            const debug = await gp.getDebug();
            const state = await gp.getGameState();

            console.log('\n=== Debug Stats ===');
            console.log(`Entity count:    ${debug.entityCount}`);
            console.log(`Map size:        ${state?.mapWidth}x${state?.mapHeight}`);
            console.log(`Camera:          (${debug.cameraX}, ${debug.cameraY})`);

            expect(state?.mapWidth).toBeGreaterThan(100);
            expect(state?.mapHeight).toBeGreaterThan(100);
            expect(debug.entityCount).toBeLessThan(2000);
            expect(debug.buildingCount).toBe(0);
            expect(debug.unitCount).toBe(0);
            expect(debug.cameraX).toBeGreaterThan(50);
            expect(debug.cameraY).toBeGreaterThan(50);
        });

        await test.step('verify no excessive console warnings', async () => {
            const sortedLogs = Array.from(logCounts.entries())
                .map(([key, count]) => {
                    const [level, text] = key.split(':');
                    return { level, text, count };
                })
                .filter((l) => l.count > 1 || l.level === 'error' || l.level === 'warning')
                .sort((a, b) => b.count - a.count);

            if (sortedLogs.length > 0) {
                console.log('\n=== Repeated/Notable Console Messages ===');
                sortedLogs.slice(0, 10).forEach((l) => {
                    console.log(`  [${l.level}] x${l.count}: ${l.text}`);
                });
            }

            // Fail if there are excessively repeated warnings
            const excessiveWarnings = sortedLogs.filter(
                (l) => l.level === 'warning' && l.count > 10
            );
            expect(excessiveWarnings).toHaveLength(0);

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
                    !l.text.includes('Unhandled promise rejection') &&
                    !l.text.includes('ResourceFile') &&
                    !l.text.includes('SoundManager')
            );
            expect(unexpectedErrors).toHaveLength(0);
        });

        checkErrors();
    });
});

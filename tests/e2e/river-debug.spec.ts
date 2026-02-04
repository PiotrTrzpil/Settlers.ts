import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * Debug test to understand river terrain type patterns in the map.
 */

test.describe('River Debug', () => {
    test('analyze river terrain patterns', async ({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: false });
        await gp.waitForReady(10, 60000);

        // Analyze terrain patterns around rivers
        const analysis = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const groundType = game.groundType;
            const mapSize = game.mapSize;
            const w = mapSize.width;
            const h = mapSize.height;

            // River types: River1=96, River2=97, River3=98, River4=99
            const riverTiles: Array<{x: number, y: number, type: number}> = [];
            const transitionPatterns: Record<string, number> = {};

            // Find all river tiles
            for (let y = 0; y < h - 1; y++) {
                for (let x = 0; x < w - 1; x++) {
                    const idx = mapSize.toIndex(x, y);
                    const type = groundType[idx];
                    if (type >= 96 && type <= 99) {
                        riverTiles.push({ x, y, type });
                    }

                    // Get the 4 corners of this parallelogram
                    const t1 = groundType[mapSize.toIndex(x, y)];
                    const t2 = groundType[mapSize.toIndex(x, y + 1)];
                    const t3 = groundType[mapSize.toIndex(x + 1, y + 1)];
                    const t4 = groundType[mapSize.toIndex(x + 1, y)];

                    // Check if any corner is a river type
                    const hasRiver = [t1, t2, t3, t4].some(t => t >= 96 && t <= 99);
                    if (hasRiver) {
                        // Triangle A uses t1, t2, t3
                        const keyA = `A:${t1}-${t2}-${t3}`;
                        transitionPatterns[keyA] = (transitionPatterns[keyA] || 0) + 1;
                        // Triangle B uses t1, t3, t4
                        const keyB = `B:${t1}-${t3}-${t4}`;
                        transitionPatterns[keyB] = (transitionPatterns[keyB] || 0) + 1;
                    }
                }
            }

            // Sort patterns by frequency
            const sortedPatterns = Object.entries(transitionPatterns)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 50); // Top 50

            return {
                totalRiverTiles: riverTiles.length,
                sampleRiverTiles: riverTiles.slice(0, 10),
                topPatterns: sortedPatterns,
            };
        });

        console.log('=== River Terrain Analysis ===');
        console.log(`Total river tiles: ${analysis?.totalRiverTiles}`);
        console.log('\nSample river tile locations:');
        analysis?.sampleRiverTiles.forEach(t => {
            console.log(`  (${t.x}, ${t.y}) type=${t.type}`);
        });
        console.log('\nTop transition patterns (triangle:t1-t2-t3):');
        analysis?.topPatterns.forEach(([pattern, count]) => {
            console.log(`  ${pattern}: ${count}`);
        });

        expect(analysis).not.toBeNull();
    });
});

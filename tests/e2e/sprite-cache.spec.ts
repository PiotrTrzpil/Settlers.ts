import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * Sprite atlas cache tests.
 *
 * Tests the two-tier caching system:
 * 1. Module-level cache (survives HMR) - not testable in e2e
 * 2. IndexedDB cache (survives page refresh) - tested here
 *
 * Note: These tests require real game assets (GFX files) to be available.
 * They won't work with testMap mode which uses procedural textures.
 */
test.describe('Sprite Atlas Cache', { tag: ['@requires-assets', '@slow'] }, () => {
    test('IndexedDB cache speeds up page refresh', async({ page }) => {
        // Note: @requires-assets project provides 60s timeout
        const gp = new GamePage(page);

        // Clear any existing cache to ensure clean state
        await page.goto('/');
        await gp.clearSpriteCache();

        // === First load (cache miss) - use real map ===
        await gp.goto(); // No testMap - loads real map with sprites
        await gp.waitForReady(5, 30_000);

        const firstLoad = await gp.getLoadTimings();

        console.log('\n=== First Load (Cache Miss) ===');
        console.log(`Total sprites: ${firstLoad.totalSprites}ms`);
        console.log(`Cache hit: ${firstLoad.cacheHit}`);
        console.log(`Cache source: ${firstLoad.cacheSource}`);

        // Skip test if no sprites were loaded (game assets not available)
        if (firstLoad.totalSprites === 0) {
            console.log('Skipping: No sprites loaded (game assets may not be available)');
            test.skip();
            return;
        }

        // First load should be a cache miss
        expect(firstLoad.cacheHit).toBe(false);
        expect(firstLoad.cacheSource).toBeNull();

        // === Second load (cache hit) ===
        // Reload the page - IndexedDB cache should persist
        await page.reload();
        await gp.waitForReady(5, 30_000);

        const secondLoad = await gp.getLoadTimings();

        console.log('\n=== Second Load (Cache Hit) ===');
        console.log(`Total sprites: ${secondLoad.totalSprites}ms`);
        console.log(`Cache hit: ${secondLoad.cacheHit}`);
        console.log(`Cache source: ${secondLoad.cacheSource}`);

        // Second load should be a cache hit from IndexedDB
        expect(secondLoad.cacheHit).toBe(true);
        expect(secondLoad.cacheSource).toBe('indexeddb');

        // Cache hit should be significantly faster
        const speedup = firstLoad.totalSprites / Math.max(secondLoad.totalSprites, 1);
        console.log(`\nSpeedup: ${speedup.toFixed(1)}x faster`);
        console.log(`First load: ${firstLoad.totalSprites}ms → Second load: ${secondLoad.totalSprites}ms`);

        // Expect at least 3x speedup (typically 10-50x in practice)
        expect(speedup).toBeGreaterThan(3);
    });
});

import { test, expect } from './fixtures';

/**
 * Sprite atlas cache tests.
 *
 * Tests the two-tier caching system:
 * 1. Module-level cache (survives HMR) - not testable in e2e
 * 2. IndexedDB cache (survives page refresh) - tested here
 *
 * Uses gpAssets fixture which:
 * - Loads real game assets (not test map)
 * - Skips in CI if assets unavailable
 * - Fails locally if assets missing
 */
test.describe('Sprite Atlas Cache', { tag: ['@requires-assets', '@slow'] }, () => {
    test('IndexedDB cache speeds up page refresh', async ({ gpAssets }) => {
        // Get first load timings (already loaded by gpAssets fixture)
        const firstLoad = await gpAssets.getLoadTimings();

        console.log('\n=== First Load (Cache Miss) ===');
        console.log(`Total sprites: ${firstLoad.totalSprites}ms`);
        console.log(`Cache hit: ${firstLoad.cacheHit}`);
        console.log(`Cache source: ${firstLoad.cacheSource}`);

        // First load should be a cache miss
        expect(firstLoad.cacheHit).toBe(false);
        expect(firstLoad.cacheSource).toBeNull();

        // === Second load (cache hit) ===
        // Reload the page - IndexedDB cache should persist
        await gpAssets.page.reload();
        await gpAssets.waitForReady(5, 30_000);

        const secondLoad = await gpAssets.getLoadTimings();

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

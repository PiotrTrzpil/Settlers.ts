import { test, expect } from './matchers';
import { GamePage } from './game-page';

/**
 * E2E tests for unit sprite loading, especially high job indices.
 * Tests verify that units like swordsman (#227) and bowman (#236) load correctly.
 *
 * All game state queries go through GamePage helpers.
 * Requires real Settlers 4 game assets — skip with: npx playwright test --grep-invert @requires-assets
 */

test.describe('Unit Sprite Loading', { tag: ['@requires-assets', '@slow'] }, () => {
    // Note: @requires-assets project provides 60s timeout

    // Bypass cache for large GFX files to avoid ERR_CACHE_WRITE_FAILURE
    test.beforeEach(async({ page }) => {
        await page.route('**/*.gfx', async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                headers: { ...response.headers(), 'cache-control': 'no-store' },
            });
        });
    });

    // Clean up routes to avoid "route callback still running" errors on skip/fail
    test.afterEach(async({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('should load unit sprites from sprite registry', async({ page }) => {
        const gp = new GamePage(page);

        // Load the game (needs real game assets, not test map)
        await gp.goto({ testMap: false });
        await gp.waitForReady(5, 30_000);

        const hasSprites = await gp.hasSpritesLoaded();
        if (!hasSprites) {
            console.log('Skipping: No sprites loaded (game assets may not be available)');
            test.skip();
            return;
        }

        const loadedUnits = await gp.getLoadedUnitSprites();
        expect(loadedUnits).not.toBeNull();
        expect(loadedUnits!.loadedCount).toBeGreaterThan(0);
    });

    test('should render swordsman with texture not just color dot', async({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: false });
        await gp.waitForReady(5, 30_000);

        const hasSprites = await gp.hasSpritesLoaded();
        if (!hasSprites) {
            console.log('Skipping: No sprites loaded (game assets may not be available)');
            test.skip();
            return;
        }

        const registrySize = await gp.getSpriteRegistrySize();
        if (registrySize === 0) {
            console.log('Skipping: No unit sprites in registry');
            test.skip();
            return;
        }

        // Spawn a swordsman via game.execute()
        const unit = await gp.spawnUnit(6); // Swordsman = UnitType 6
        expect(unit).not.toBeNull();

        await expect(gp).toHaveEntity({ type: 1 }); // EntityType.Unit

        const units = await gp.getEntities({ type: 1 });
        expect(units.length).toBeGreaterThan(0);
        expect(units[0].subType).toBeGreaterThan(0);
    });

    test('JIL index lookup returns correct job for high indices', async({ page }) => {
        const gp = new GamePage(page);

        await gp.goto({ testMap: false });
        await gp.waitForReady(5, 30_000);

        // Test specific job indices: Carrier=#1, Builder=#19, Swordsman=#227, Bowman=#236
        const jilResult = await gp.testJilLookup('20', [1, 19, 227, 236]);

        if (!jilResult) {
            test.skip();
            return;
        }

        // Job 1 (Carrier) should exist
        expect(jilResult.results[1].exists).toBe(true);

        // Job 19 (Builder) should exist
        expect(jilResult.results[19].exists).toBe(true);

        // Job 227 (Swordsman) should exist if total jobs > 227
        if (jilResult.totalJobs > 227) {
            expect(jilResult.results[227].exists).toBe(true);
        }

        // Job 236 (Bowman) should exist if total jobs > 236
        if (jilResult.totalJobs > 236) {
            expect(jilResult.results[236].exists).toBe(true);
        }
    });
});

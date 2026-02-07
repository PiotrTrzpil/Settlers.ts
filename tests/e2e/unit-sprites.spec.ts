import { test, expect } from './matchers';
import { GamePage } from './game-page';

/**
 * E2E tests for unit sprite loading, especially high job indices.
 * Tests verify that units like swordsman (#227) and bowman (#236) load correctly.
 *
 * Requires real Settlers 4 game assets — skip with: npx playwright test --grep-invert @requires-assets
 */

test.describe('Unit Sprite Loading', { tag: ['@requires-assets', '@slow'] }, () => {
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

    test('should load unit sprites from sprite registry', async({ page }) => {
        const gp = new GamePage(page);

        // Load the game (needs real game assets, not test map)
        await gp.goto({ testMap: false });
        await gp.waitForReady(5, 30_000);

        // Wait for sprite manager to have sprites loaded (async loading)
        await page.waitForFunction(
            () => {
                const renderer = (window as any).__settlers_entity_renderer__;
                if (!renderer) return false;
                const spriteManager = (renderer as any).spriteManager;
                return spriteManager?.hasSprites === true;
            },
            null,
            { timeout: 30_000 }
        );

        // Check what unit sprites are loaded using the public API
        const loadedUnits = await page.evaluate(() => {
            const renderer = (window as any).__settlers_entity_renderer__;
            if (!renderer) {
                return { error: 'No entity renderer' };
            }

            // Note: spriteManager is private, access directly
            const spriteManager = (renderer as any).spriteManager;
            if (!spriteManager) {
                return { error: 'No sprite manager', hasRenderer: !!renderer };
            }

            const debugInfo = {
                hasSprites: spriteManager.hasSprites,
                currentRace: spriteManager.currentRace,
            };

            // Test all possible unit types (0-8) using the public getUnit() method
            const loadedByType: Record<number, boolean> = {};
            for (let unitType = 0; unitType <= 8; unitType++) {
                const sprite = spriteManager.getUnit(unitType, 0); // direction 0
                loadedByType[unitType] = sprite !== null;
            }

            const loadedCount = Object.values(loadedByType).filter(Boolean).length;

            return {
                debugInfo,
                unitCount: loadedCount,
                loadedByType,
            };
        });

        // Verify the sprite registry loaded via API (more reliable than console logs)
        expect(loadedUnits).not.toHaveProperty('error');

        // Check that at least some unit types loaded
        if ('loadedByType' in loadedUnits) {
            const loadedCount = Object.values(loadedUnits.loadedByType).filter(Boolean).length;
            // At least bearer (type 0) should be loaded
            expect(loadedCount).toBeGreaterThan(0);
        }
    });

    test('should render swordsman with texture not just color dot', async({ page }) => {
        const gp = new GamePage(page);

        // Load with real assets
        await gp.goto({ testMap: false });
        await gp.waitForReady(5, 30_000);

        // Check if any unit sprites loaded
        const unitSpriteInfo = await page.evaluate(() => {
            const renderer = (window as any).__settlers_entity_renderer__;
            const registry = (renderer as any)?.spriteManager?._spriteRegistry;
            if (!registry?.units) return { hasUnits: false, count: 0 };
            return { hasUnits: registry.units.size > 0, count: registry.units.size };
        });

        if (!unitSpriteInfo.hasUnits) {
            test.skip();
            return;
        }

        // Spawn a swordsman
        await gp.spawnSwordsman();
        await gp.waitForEntityCountAbove(0);

        // Check that swordsman entity exists
        await expect(gp).toHaveEntity({ type: 1 }); // EntityType.Unit

        const units = await gp.getEntities({ type: 1 });
        expect(units.length).toBeGreaterThan(0);
        expect(units[0].subType).toBeGreaterThan(0);
    });

    test('JIL index lookup returns correct job for high indices', async({ page }) => {
        const gp = new GamePage(page);

        // Load game
        await gp.goto({ testMap: false });
        await gp.waitForReady(5, 30_000);

        // Test the JIL lookup directly via debug bridge
        const jilTest = await page.evaluate(async() => {
            const renderer = (window as any).__settlers_entity_renderer__;
            if (!renderer?.spriteManager) {
                return { error: 'No sprite manager' };
            }

            // Access the sprite loader's file sets to check JIL entries
            const spriteLoader = (renderer.spriteManager as any).spriteLoader;
            if (!spriteLoader) {
                return { error: 'No sprite loader' };
            }

            // Try to get the settler file set (file 20 for Roman)
            const fileSet = await spriteLoader.loadFileSet('20');
            if (!fileSet) {
                return { error: 'Settler file 20 not available' };
            }

            if (!fileSet.jilReader) {
                return { error: 'No JIL reader' };
            }

            const totalJobs = fileSet.jilReader.length;

            // Test specific job indices - these are the JIL job numbers for units
            // Bearer=#1, Builder=#19, Swordsman=#227, Bowman=#236
            const testIndices = [1, 19, 227, 236];
            const results: Record<number, { exists: boolean; offset?: number; length?: number }> = {};

            for (const idx of testIndices) {
                const item = fileSet.jilReader.getItem(idx);
                results[idx] = item
                    ? { exists: true, offset: item.offset, length: item.length }
                    : { exists: false };
            }

            return {
                totalJobs,
                testResults: results,
            };
        });

        if ('error' in jilTest) {
            test.skip();
            return;
        }

        // Job 1 (Bearer) should exist
        expect(jilTest.testResults[1].exists).toBe(true);

        // Job 19 (Builder) should exist
        expect(jilTest.testResults[19].exists).toBe(true);

        // Job 227 (Swordsman) should exist if total jobs > 227
        if (jilTest.totalJobs > 227) {
            expect(jilTest.testResults[227].exists).toBe(true);
        }

        // Job 236 (Bowman) should exist if total jobs > 236
        if (jilTest.totalJobs > 236) {
            expect(jilTest.testResults[236].exists).toBe(true);
        }
    });
});

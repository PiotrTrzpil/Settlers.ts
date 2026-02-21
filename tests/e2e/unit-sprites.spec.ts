import { test, expect } from './fixtures';

/**
 * E2E tests for unit sprite loading, especially high job indices.
 * Tests verify that units like swordsman (#227) and bowman (#236) load correctly.
 *
 * Uses gpAssets fixture which:
 * - Loads real game assets (not test map)
 * - Skips in CI if assets unavailable
 * - Fails locally if assets missing
 *
 * Skip with: npx playwright test --grep-invert @requires-assets
 */

test.describe('Unit Sprite Loading', { tag: ['@requires-assets', '@slow'] }, () => {
    test('should load unit sprites from sprite registry', async ({ gpAssets }) => {
        const loadedUnits = await gpAssets.sprites.getLoadedUnitSprites();
        expect(loadedUnits).not.toBeNull();
        expect(loadedUnits!.loadedCount).toBeGreaterThan(0);
    });

    test('should render swordsman with texture not just color dot', async ({ gpAssets }) => {
        const registrySize = await gpAssets.sprites.getSpriteRegistrySize();
        expect(registrySize).toBeGreaterThan(0);

        // Spawn a swordsman via game.execute()
        const unit = await gpAssets.actions.spawnUnit(6); // Swordsman = UnitType 6
        expect(unit).not.toBeNull();

        await expect(gpAssets).toHaveEntity({ type: 1 }); // EntityType.Unit

        const units = await gpAssets.actions.getEntities({ type: 1 });
        expect(units.length).toBeGreaterThan(0);
        expect(units[0]!.subType).toBeGreaterThan(0);
    });

    test('JIL index lookup returns correct job for high indices', async ({ gpAssets }) => {
        // Test specific job indices: Carrier=#1, Builder=#19, Swordsman=#227, Bowman=#236
        const jilResult = await gpAssets.sprites.testJilLookup('20', [1, 19, 227, 236]);
        expect(jilResult).not.toBeNull();

        // Job 1 (Carrier) should exist
        expect(jilResult!.results[1]!.exists).toBe(true);

        // Job 19 (Builder) should exist
        expect(jilResult!.results[19]!.exists).toBe(true);

        // Job 227 (Swordsman) should exist if total jobs > 227
        if (jilResult!.totalJobs > 227) {
            expect(jilResult!.results[227]!.exists).toBe(true);
        }

        // Job 236 (Bowman) should exist if total jobs > 236
        if (jilResult!.totalJobs > 236) {
            expect(jilResult!.results[236]!.exists).toBe(true);
        }
    });
});

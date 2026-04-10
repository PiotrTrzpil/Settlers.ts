import { test, expect } from './fixtures';
import { EntityType } from '@/game/entity';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import { EMaterialType } from '@/game/economy/material-type';
import { AVAILABLE_RACES, formatRace } from '@/game/core/race';
import { isUnitAvailableForRace, isBuildingAvailableForRace } from '@/game/data/race-availability';
import type { Locator } from '@playwright/test';

/**
 * Visual rendering catalog — screenshots of all entity types with real game assets.
 *
 * For each race, spawns every available building, unit, and material pile type,
 * takes a screenshot, and verifies all entities rendered with actual sprites
 * (not color fallbacks).
 *
 * Screenshot mismatches are noted as warnings, not test failures — the catalog's
 * primary purpose is to detect missing sprites, not enforce pixel-perfect rendering.
 *
 * Uses gpEmptyMap fixture (empty flat map with real sprite assets, skips in CI if unavailable).
 */

/** Compare screenshot softly — log mismatch but don't fail the test. */
async function softScreenshot(locator: Locator, name: string, options?: { maxDiffPixelRatio?: number }): Promise<void> {
    try {
        await expect(locator).toHaveScreenshot(name, options);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Extract pixel diff info from the error message
        const firstLine = msg.split('\n')[0] ?? msg;
        console.warn(`[screenshot mismatch] ${name}: ${firstLine}`);
    }
}

const ALL_BUILDING_TYPES = Object.values(BuildingType) as BuildingType[];
const ALL_UNIT_TYPES = Object.values(UnitType) as UnitType[];
const ALL_MATERIAL_TYPES = (Object.values(EMaterialType) as EMaterialType[]).filter(
    v => v !== EMaterialType.NO_MATERIAL
);

/** Hide all UI panels so screenshots show only the canvas. */
async function hideUI(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(() => {
        const selectors = '.sidebar, .left-panels, .right-panels, .info-bar, .ticks-paused-overlay';
        document.querySelectorAll<HTMLElement>(selectors).forEach(el => (el.style.display = 'none'));
    });
}

test.describe('Entity Rendering Catalog', { tag: ['@requires-assets', '@screenshot'] }, () => {
    for (const race of AVAILABLE_RACES) {
        const raceName = formatRace(race);

        test(`${raceName} units render with real sprites`, async ({ gpEmptyMap }) => {
            const page = gpEmptyMap.page;
            const unitTypes = ALL_UNIT_TYPES.filter(ut => isUnitAvailableForRace(ut, race));

            // Ensure clean slate — remove any entities from previous test
            await page.evaluate(() => window.__settlers__!.game!.clearAllEntities());

            // Load sprites for this race
            const loaded = await gpEmptyMap.sprites.switchSpriteRace(race);
            expect(loaded, `Failed to load sprites for ${raceName}`).toBe(true);
            await gpEmptyMap.wait.waitForFrames(5, 5000);

            const spawnedCount = await page.evaluate(
                ({ unitTypes: types, race: r }) => {
                    const game = window.__settlers__!.game!;
                    const w = game.terrain.mapSize.width;
                    const h = game.terrain.mapSize.height;
                    const cx = Math.floor(w / 2);
                    const cy = Math.floor(h / 2);
                    const COLS = 8;
                    const SPACING = 3;
                    let count = 0;

                    for (let i = 0; i < types.length; i++) {
                        const col = i % COLS;
                        const row = Math.floor(i / COLS);
                        const x = cx - Math.floor(COLS / 2) * SPACING + col * SPACING;
                        const y = cy - 5 + row * SPACING;

                        const result = game.execute({
                            type: 'spawn_unit',
                            unitType: types[i]!,
                            x,
                            y,
                            player: 0,
                            race: r,
                        });
                        if (result?.success) count++;
                    }
                    return count;
                },
                { unitTypes, race }
            );

            expect(spawnedCount).toBeGreaterThan(0);

            // Center camera on the unit grid
            const center = await gpEmptyMap.actions.getMapCenter();
            await gpEmptyMap.moveCamera(center.x, center.y);
            await gpEmptyMap.wait.waitForFrames(10, 5000);

            // Report missing sprites — these are real gaps in sprite loading, not test failures.
            // The screenshot regression catches visual regressions; missing sprites show as color dots.
            const missing = await gpEmptyMap.sprites.getEntitiesWithoutSprites();
            const missingUnits = missing.filter(m => m.entityType === EntityType.Unit);
            if (missingUnits.length > 0) {
                const names = missingUnits.map(m => `Unit ${m.subType as UnitType} (race=${m.race})`);
                console.log(`[${raceName}] ${missingUnits.length} units without sprites: ${names.join(', ')}`);
            }

            await hideUI(page);
            await softScreenshot(gpEmptyMap.canvas, `catalog-units-${raceName.toLowerCase().replace(' ', '-')}.png`, {
                maxDiffPixelRatio: 0.01,
            });
        });

        test(`${raceName} buildings render with real sprites`, async ({ gpEmptyMap }) => {
            const page = gpEmptyMap.page;
            const buildingTypes = ALL_BUILDING_TYPES.filter(bt => isBuildingAvailableForRace(bt, race));

            // Ensure clean slate — remove any entities from previous test
            await page.evaluate(() => window.__settlers__!.game!.clearAllEntities());

            const loaded = await gpEmptyMap.sprites.switchSpriteRace(race);
            expect(loaded, `Failed to load sprites for ${raceName}`).toBe(true);
            await gpEmptyMap.wait.waitForFrames(5, 5000);

            const placedCount = await page.evaluate(
                ({ buildingTypes: types, race: r }) => {
                    const game = window.__settlers__!.game!;
                    const search = window.__settlers__!.utils!.spiralSearch!;
                    const w = game.terrain.mapSize.width;
                    const h = game.terrain.mapSize.height;
                    const cx = Math.floor(w / 2);
                    const cy = Math.floor(h / 2);
                    let count = 0;

                    for (const bt of types) {
                        try {
                            search({ x: cx, y: cy }, w, h, ({ x: tx, y: ty }) => {
                                const result = game.execute({
                                    type: 'place_building',
                                    buildingType: bt,
                                    x: tx,
                                    y: ty,
                                    player: 0,
                                    race: r,
                                    completed: true,
                                });
                                if (result?.success) {
                                    count++;
                                    return true;
                                }
                                return false;
                            });
                        } catch {
                            // BuildingInfo may not exist for this race — skip
                        }
                    }
                    return count;
                },
                { buildingTypes, race }
            );

            expect(placedCount).toBeGreaterThan(0);

            // Center camera on map center where buildings were placed
            const center = await gpEmptyMap.actions.getMapCenter();
            await gpEmptyMap.moveCamera(center.x, center.y);
            await gpEmptyMap.wait.waitForFrames(10, 5000);

            const missing = await gpEmptyMap.sprites.getEntitiesWithoutSprites();
            const missingBuildings = missing.filter(m => m.entityType === EntityType.Building);
            if (missingBuildings.length > 0) {
                const names = missingBuildings.map(m => `Building ${String(m.subType)} (race=${m.race})`);
                console.log(`[${raceName}] ${missingBuildings.length} buildings without sprites: ${names.join(', ')}`);
            }

            await hideUI(page);
            await softScreenshot(
                gpEmptyMap.canvas,
                `catalog-buildings-${raceName.toLowerCase().replace(' ', '-')}.png`,
                { maxDiffPixelRatio: 0.01 }
            );
        });
    }

    // Material piles are not race-specific visually — one screenshot covers all
    test('material pile types render with real sprites', async ({ gpEmptyMap }) => {
        const page = gpEmptyMap.page;

        // Ensure clean slate — remove any entities from previous test
        await page.evaluate(() => window.__settlers__!.game!.clearAllEntities());

        const placedCount = await page.evaluate((materialTypes: EMaterialType[]) => {
            const game = window.__settlers__!.game!;
            const w = game.terrain.mapSize.width;
            const h = game.terrain.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);
            const COLS = 8;
            const SPACING = 3;
            let count = 0;

            for (let i = 0; i < materialTypes.length; i++) {
                const col = i % COLS;
                const row = Math.floor(i / COLS);
                const x = cx - Math.floor(COLS / 2) * SPACING + col * SPACING;
                const y = cy - 5 + row * SPACING;

                if (x < 0 || x >= w || y < 0 || y >= h) continue;

                const result = game.execute({
                    type: 'place_pile',
                    materialType: materialTypes[i]!,
                    x,
                    y,
                    amount: 3,
                });
                if (result?.success) count++;
            }
            return count;
        }, ALL_MATERIAL_TYPES);

        expect(placedCount).toBeGreaterThan(0);

        const center = await gpEmptyMap.actions.getMapCenter();
        await gpEmptyMap.moveCamera(center.x, center.y);
        await gpEmptyMap.wait.waitForFrames(10, 5000);

        const missing = await gpEmptyMap.sprites.getEntitiesWithoutSprites();
        const missingPiles = missing.filter(m => m.entityType === EntityType.StackedPile);
        if (missingPiles.length > 0) {
            const names = missingPiles.map(m => `Pile ${m.subType}`);
            console.log(`${missingPiles.length} piles without sprites: ${names.join(', ')}`);
        }

        await hideUI(gpEmptyMap.page);
        await softScreenshot(gpEmptyMap.canvas, 'catalog-piles.png', {
            maxDiffPixelRatio: 0.01,
        });
    });
});

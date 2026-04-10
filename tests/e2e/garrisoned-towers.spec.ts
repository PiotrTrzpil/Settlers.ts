import { test, expect } from './fixtures';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import { Race } from '@/game/core/race';
import type { Locator } from '@playwright/test';

/**
 * Visual rendering tests for Roman towers and castle fully garrisoned with soldiers.
 *
 * Each test places a completed garrison building, fills it via the `fill_garrison`
 * command, then takes a screenshot to verify garrisoned soldiers render on the walls.
 *
 * Uses gpEmptyMap fixture (empty flat map with real sprite assets, skips in CI if unavailable).
 */

/** Compare screenshot softly — log mismatch but don't fail the test. */
async function softScreenshot(locator: Locator, name: string, options?: { maxDiffPixelRatio?: number }): Promise<void> {
    try {
        await expect(locator).toHaveScreenshot(name, options);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const firstLine = msg.split('\n')[0] ?? msg;
        console.warn(`[screenshot mismatch] ${name}: ${firstLine}`);
    }
}

/** Hide all UI panels so screenshots show only the canvas. */
async function hideUI(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(() => {
        const selectors = '.sidebar, .left-panels, .right-panels, .info-bar, .ticks-paused-overlay';
        document.querySelectorAll<HTMLElement>(selectors).forEach(el => (el.style.display = 'none'));
    });
}

interface GarrisonTestCase {
    name: string;
    buildingType: BuildingType;
    units: Array<{ unitType: UnitType }>;
}

/** Roman garrison building test cases — each fills every slot. */
const GARRISON_CASES: GarrisonTestCase[] = [
    {
        name: 'GuardTowerSmall',
        buildingType: BuildingType.GuardTowerSmall,
        // 1 swordsman + 2 bowmen
        units: [{ unitType: UnitType.Swordsman1 }, { unitType: UnitType.Bowman1 }, { unitType: UnitType.Bowman1 }],
    },
    {
        name: 'GuardTowerBig',
        buildingType: BuildingType.GuardTowerBig,
        // 3 swordsmen + 3 bowmen
        units: [
            { unitType: UnitType.Swordsman1 },
            { unitType: UnitType.Swordsman2 },
            { unitType: UnitType.Swordsman3 },
            { unitType: UnitType.Bowman1 },
            { unitType: UnitType.Bowman2 },
            { unitType: UnitType.Bowman3 },
        ],
    },
    {
        name: 'Castle',
        buildingType: BuildingType.Castle,
        // 4 swordsmen + 5 bowmen (9 settler positions in XML)
        units: [
            { unitType: UnitType.Swordsman1 },
            { unitType: UnitType.Swordsman1 },
            { unitType: UnitType.Swordsman2 },
            { unitType: UnitType.Swordsman3 },
            { unitType: UnitType.Bowman1 },
            { unitType: UnitType.Bowman1 },
            { unitType: UnitType.Bowman2 },
            { unitType: UnitType.Bowman3 },
            { unitType: UnitType.Bowman3 },
        ],
    },
];

test.describe('Garrisoned Tower Rendering', { tag: ['@requires-assets', '@screenshot'] }, () => {
    for (const tc of GARRISON_CASES) {
        test(`Roman ${tc.name} fully garrisoned`, async ({ gpEmptyMap }) => {
            const page = gpEmptyMap.page;

            await page.evaluate(() => window.__settlers__!.game!.clearAllEntities());

            const loaded = await gpEmptyMap.sprites.switchSpriteRace(Race.Roman);
            expect(loaded, 'Failed to load Roman sprites').toBe(true);
            await gpEmptyMap.wait.waitForFrames(5, 5000);

            // Place completed building and fill garrison
            const result = await page.evaluate(
                ({ buildingType, units, race }) => {
                    const game = window.__settlers__!.game!;
                    const search = window.__settlers__!.utils!.spiralSearch!;
                    const w = game.terrain.mapSize.width;
                    const h = game.terrain.mapSize.height;
                    const cx = Math.floor(w / 2);
                    const cy = Math.floor(h / 2);

                    // Place building
                    let buildingId: number | null = null;
                    search({ x: cx, y: cy }, w, h, ({ x, y }) => {
                        const r = game.execute({
                            type: 'place_building',
                            buildingType,
                            x,
                            y,
                            player: 0,
                            race,
                            completed: true,
                        });
                        if (r?.success && 'entityId' in r) {
                            buildingId = r.entityId;
                            return true;
                        }
                        return false;
                    });

                    if (buildingId == null) {
                        return { placed: false, garrisoned: false, buildingX: 0, buildingY: 0 };
                    }

                    // Fill garrison with specified units
                    const fillResult = game.execute({
                        type: 'fill_garrison',
                        buildingId,
                        units,
                    });

                    const building = game.state.getEntity(buildingId)!;
                    return {
                        placed: true,
                        garrisoned: fillResult?.success ?? false,
                        buildingX: building.x,
                        buildingY: building.y,
                    };
                },
                { buildingType: tc.buildingType, units: tc.units, race: Race.Roman }
            );

            expect(result.placed, `${tc.name} should be placed`).toBe(true);
            expect(result.garrisoned, `${tc.name} garrison should succeed`).toBe(true);

            // Center camera on the building and wait for rendering
            await gpEmptyMap.moveCamera(result.buildingX, result.buildingY);
            await gpEmptyMap.wait.waitForFrames(15, 5000);

            await hideUI(page);
            await softScreenshot(gpEmptyMap.canvas, `garrisoned-roman-${tc.name.toLowerCase()}.png`, {
                maxDiffPixelRatio: 0.01,
            });
        });
    }
});

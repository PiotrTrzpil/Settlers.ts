import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * E2E tests for the stonecutter production chain.
 * Verifies that the stonecutter worker finds a ResourceStone, mines it,
 * and deposits 1 STONE into the building's output slot.
 *
 * Requires:
 * - StonecutterHut (spawns stonecutter worker on completion)
 * - ResourceStone map objects within 30 tiles of the hut
 * - placeBuildingsCompleted=true so the hut is immediately active
 * - placeBuildingsWithWorker=true so the stonecutter unit is spawned
 */

// BuildingType enum values
const STONECUTTER_HUT = 4;

// EMaterialType enum values
const STONE = 1;

/** Gather diagnostic state from the game for debugging stonecutter behavior. */
async function gatherDiagnosticState(page: Page, scId: number) {
    const raw = await page.evaluate(
        ({ buildingId }) => {
            const game = window.__settlers__?.game;
            if (!game) return null;
            const units = game.state.entities.filter((e: any) => e.type === 1);
            const stones = game.state.entities.filter((e: any) => e.type === 3 && e.subType === 103);
            const buildings = game.state.entities.filter((e: any) => e.type === 2);
            const svc = game.services;
            const invSlots: any[] = svc?.inventoryManager?.hasSlots?.(buildingId)
                ? (svc.inventoryManager.getSlots(buildingId) as any[])
                : [];
            return {
                units: units.map((u: any) => ({
                    id: u.id,
                    subType: u.subType,
                    x: u.x,
                    y: u.y,
                    hidden: u.hidden,
                    player: u.player,
                    race: u.race,
                })),
                buildings: buildings.map((b: any) => ({
                    id: b.id,
                    subType: b.subType,
                    x: b.x,
                    y: b.y,
                    player: b.player,
                    race: b.race,
                })),
                stoneCount: stones.length,
                stoneStats: svc?.stoneSystem?.getStats?.() ?? null,
                invSlots,
                taskRuntimes: svc?.settlerTaskSystem?.getDebugInfo?.() ?? null,
                managedFlags: units.map((u: any) => svc?.settlerTaskSystem?.isManaged?.(u.id) ?? null),
            };
        },
        { buildingId: scId }
    );
    if (!raw) return null;
    return {
        unitCount: raw.units.length,
        units: raw.units,
        buildings: raw.buildings,
        stoneCount: raw.stoneCount,
        stoneStats: raw.stoneStats,
        invOutput:
            raw.invSlots.length > 0
                ? raw.invSlots
                      .filter((s: any) => s.kind === 'output' || s.kind === 'storage')
                      .map((s: any) => ({ mat: s.materialType, amt: s.currentAmount }))
                : null,
        taskRuntimes: raw.taskRuntimes,
        gameDataStatus:
            'settlerConfigs-ok:' +
            raw.managedFlags.join(',') +
            ' buildings:' +
            raw.buildings.map((b: any) => b.subType).join(','),
    };
}

test.describe('Stonecutter Production', { tag: '@slow' }, () => {
    test('stonecutter mines ResourceStone and outputs 1 stone', async ({ gp }) => {
        test.setTimeout(60_000);
        await gp.actions.setGameSetting('placeBuildingsCompleted', true);
        await gp.actions.setGameSetting('placeBuildingsWithWorker', true);

        let stonecutterId: number;

        await test.step('place StonecutterHut', async () => {
            const scTile = await gp.actions.findBuildableTile(STONECUTTER_HUT);
            expect(scTile).not.toBeNull();
            const stonecutter = await gp.actions.placeBuilding(STONECUTTER_HUT, scTile!.x, scTile!.y);
            expect(stonecutter).not.toBeNull();
            stonecutterId = stonecutter!.id;

            await expect(gp).toHaveBuildingCount(1);
        });

        await test.step('plant ResourceStone near the hut', async () => {
            const entities = await gp.actions.getEntities({ type: 2, subType: STONECUTTER_HUT });
            const sc = entities[0]!;
            // Plant 6 stones within 10 tiles — stonecutter searches within 30
            const planted = await gp.actions.plantStonesNear(sc.x, sc.y, 6, 10);
            expect(planted).toBeGreaterThanOrEqual(3);
        });

        await test.step('verify stonecutter worker spawned', async () => {
            const unitCount = await gp.getViewField('unitCount');
            expect(unitCount).toBeGreaterThanOrEqual(1);
        });

        await test.step('verify output slot is STONE', async () => {
            const inv = await gp.actions.getBuildingInventory(stonecutterId);
            expect(inv).not.toBeNull();
            expect(inv!.outputSlots[0]!.materialType).toBe(STONE);
        });

        await test.step('diagnostic: dump worker+stone state after 5s', async () => {
            await gp.wait.waitForTicks(100, 10_000);
            const state = await gatherDiagnosticState(gp.page, stonecutterId);
            if (state) {
                console.log('=== STONECUTTER DEBUG ===', JSON.stringify(state, null, 2));
            }
        });

        await test.step('stonecutter produces 1 stone', async () => {
            // Stonecutter: find ResourceStone → walk → mine (6s) → pickup STONE → walk home → dropoff
            // At 4x speed this takes ~5–10 real seconds
            await gp.wait.waitForBuildingOutput(stonecutterId, STONE, 1, 25_000);

            const inv = await gp.actions.getBuildingInventory(stonecutterId);
            expect(inv!.outputSlots[0]!.currentAmount).toBeGreaterThanOrEqual(1);
        });
    });
});

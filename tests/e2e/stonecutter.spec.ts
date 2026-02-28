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
            const state = await gp.page.evaluate(
                ({ scId }) => {
                    const game = window.__settlers__?.game;
                    if (!game) return null;
                    const units = game.state.entities.filter((e: any) => e.type === 1); // Unit
                    const stones = game.state.entities.filter((e: any) => e.type === 3 && e.subType === 103); // ResourceStone
                    const buildings = game.state.entities.filter((e: any) => e.type === 2); // Building
                    const stoneStats = game.services?.stoneSystem?.getStats?.() ?? null;
                    const inv = game.services?.inventoryManager?.getInventory?.(scId) ?? null;
                    const taskRuntimes = game.services?.settlerTaskSystem?.getDebugInfo?.() ?? null;
                    // Check game data: try an operation that requires it
                    let gameDataStatus: string;
                    try {
                        // isManaged uses settlerConfigs (loaded from YAML, always available)
                        const managed = units.map((u: any) => game.services?.settlerTaskSystem?.isManaged?.(u.id));
                        gameDataStatus =
                            'settlerConfigs-ok:' +
                            managed.join(',') +
                            ' buildings:' +
                            buildings.map((b: any) => b.subType).join(',');
                    } catch (e: any) {
                        gameDataStatus = 'error:' + e?.message;
                    }
                    return {
                        unitCount: units.length,
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
                        stoneStats,
                        invOutput: inv
                            ? inv.outputSlots.map((s: any) => ({ mat: s.materialType, amt: s.currentAmount }))
                            : null,
                        taskRuntimes,
                        gameDataStatus,
                    };
                },
                { scId: stonecutterId }
            );
            console.log('=== STONECUTTER DEBUG ===', JSON.stringify(state, null, 2));
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

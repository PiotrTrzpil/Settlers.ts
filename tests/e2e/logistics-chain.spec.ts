import { test, expect } from './fixtures';

/**
 * E2E tests for the full logistics chain.
 * Verifies that production buildings, carriers, and the logistics dispatcher
 * work together to move materials through production chains.
 *
 * Chain tested: WoodcutterHut → (carrier delivers LOG) → Sawmill → BOARD
 *
 * Requires:
 * - ResidenceSmall as logistics hub (spawns carriers)
 * - WoodcutterHut (woodcutter finds tree, chops, deposits LOG)
 * - Sawmill (sawmill worker consumes LOG, produces BOARD)
 * - All buildings within the same service area radius
 * - Trees planted near the woodcutter hut (test map trees may be far away)
 */

// BuildingType enum values
const WOODCUTTER_HUT = 1;
const SAWMILL = 3;
const RESIDENCE_SMALL = 29;

// EMaterialType enum values
const LOG = 0;
const BOARD = 9;

test.describe('Logistics Chain', { tag: '@slow' }, () => {
    test('wood production chain: tree → log → board', async ({ gp }) => {
        // Enable instant building completion with auto-spawned workers
        await gp.actions.setGameSetting('placeBuildingsCompleted', true);
        await gp.actions.setGameSetting('placeBuildingsWithWorker', true);
        await gp.actions.setGameSpeed(4.0);

        let woodcutterId: number;
        let sawmillId: number;

        await test.step('place buildings in a cluster', async () => {
            // Place residence first (logistics hub)
            const resTile = await gp.actions.findBuildableTile(RESIDENCE_SMALL);
            expect(resTile).not.toBeNull();
            const residence = await gp.actions.placeBuilding(RESIDENCE_SMALL, resTile!.x, resTile!.y);
            expect(residence).not.toBeNull();

            // Place woodcutter hut nearby
            const wcTile = await gp.actions.findBuildableTileNear(WOODCUTTER_HUT, resTile!.x, resTile!.y);
            expect(wcTile).not.toBeNull();
            const woodcutter = await gp.actions.placeBuilding(WOODCUTTER_HUT, wcTile!.x, wcTile!.y);
            expect(woodcutter).not.toBeNull();
            woodcutterId = woodcutter!.id;

            // Place sawmill nearby
            const smTile = await gp.actions.findBuildableTileNear(SAWMILL, resTile!.x, resTile!.y);
            expect(smTile).not.toBeNull();
            const sawmill = await gp.actions.placeBuilding(SAWMILL, smTile!.x, smTile!.y);
            expect(sawmill).not.toBeNull();
            sawmillId = sawmill!.id;

            await expect(gp).toHaveBuildingCount(3);
        });

        await test.step('plant trees near woodcutter', async () => {
            // The woodcutter searches for trees within 30 tiles. Plant several
            // near the woodcutter hut so it has work to do.
            const entities = await gp.actions.getEntities({ type: 2, subType: WOODCUTTER_HUT });
            const wc = entities[0]!;
            const planted = await gp.actions.plantTreesNear(wc.x, wc.y, 6, 10);
            expect(planted).toBeGreaterThanOrEqual(3);
        });

        await test.step('verify workers spawned', async () => {
            // ResidenceSmall: 2 carriers, WoodcutterHut: 1 woodcutter, Sawmill: 1 sawmill worker
            const unitCount = await gp.getViewField('unitCount');
            expect(unitCount).toBeGreaterThanOrEqual(4);
        });

        await test.step('verify inventories created', async () => {
            const woodcutterInv = await gp.actions.getBuildingInventory(woodcutterId);
            expect(woodcutterInv).not.toBeNull();
            expect(woodcutterInv!.outputSlots[0]!.materialType).toBe(LOG);

            const sawmillInv = await gp.actions.getBuildingInventory(sawmillId);
            expect(sawmillInv).not.toBeNull();
            expect(sawmillInv!.inputSlots[0]!.materialType).toBe(LOG);
            expect(sawmillInv!.outputSlots[0]!.materialType).toBe(BOARD);
        });

        await test.step('woodcutter produces log', async () => {
            // Woodcutter: find tree → walk → chop (10s) → pickup LOG → walk home → dropoff
            // At 4x speed this takes ~5-8 real seconds
            await gp.wait.waitForBuildingOutput(woodcutterId, LOG, 1, 25_000);
        });

        await test.step('carrier delivers log to sawmill', async () => {
            // Carrier picks up LOG from WoodcutterHut, delivers to Sawmill input.
            // The LOG may be consumed quickly by the sawmill worker, so also check
            // if BOARD has been produced (meaning LOG was delivered and processed).
            await gp.page.waitForFunction(
                ({ sawId, logMat, boardMat }) => {
                    const game = window.__settlers__?.game;
                    if (!game?.services?.inventoryManager) return false;
                    const logInput = game.services.inventoryManager.getInputAmount(sawId, logMat);
                    const boardOutput = game.services.inventoryManager.getOutputAmount(sawId, boardMat);
                    return logInput >= 1 || boardOutput >= 1;
                },
                { sawId: sawmillId, logMat: LOG, boardMat: BOARD },
                { timeout: 20_000 }
            );
        });

        await test.step('sawmill produces board', async () => {
            // Sawmill worker: consumes LOG from input → 4s work → deposits BOARD to output
            await gp.wait.waitForBuildingOutput(sawmillId, BOARD, 1, 20_000);

            const inv = await gp.actions.getBuildingInventory(sawmillId);
            expect(inv!.outputSlots[0]!.currentAmount).toBeGreaterThanOrEqual(1);
        });
    });
});

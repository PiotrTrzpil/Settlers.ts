import { test, expect } from './fixtures';
import { BuildingType } from '@/game/buildings/building-type';
import { Timeout } from './wait-config';

/**
 * E2E tests for game state reset (restoreToInitialState).
 *
 * Reset is called between every e2e test via the gp fixture, so bugs here
 * break the entire test suite. These tests verify that reset works correctly
 * even when buildings have active logistics state (inventories, reservations).
 */

test.describe('Game State Reset', { tag: '@smoke' }, () => {
    test('reset clears buildings and units without errors', async ({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        // Place a storage area + woodcutter (triggers inventory + logistics registration)
        const storageTile = await gp.actions.findBuildableTile(BuildingType.StorageArea);
        if (!storageTile) {
            test.skip();
            return;
        }
        await gp.actions.placeBuilding(BuildingType.StorageArea, storageTile.x, storageTile.y);

        const woodcutterTile = await gp.actions.findBuildableTile(BuildingType.WoodcutterHut);
        if (!woodcutterTile) {
            test.skip();
            return;
        }
        await gp.actions.placeBuilding(BuildingType.WoodcutterHut, woodcutterTile.x, woodcutterTile.y);

        // Spawn a carrier so logistics can create reservations
        await gp.actions.spawnUnit('Carrier');

        // Let the game tick so logistics dispatches requests/reservations
        await gp.wait.waitForFrames(30);

        await expect(gp).toHaveBuildingCount(2);

        // Reset — this must not throw (previously crashed on inventory removal order)
        await gp.resetGameState();

        await expect(gp).toHaveBuildingCount(0);
        await expect(gp).toHaveUnitCount(0);

        checkErrors();
    });

    test('reset is idempotent — double reset does not throw', async ({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        await gp.actions.placeBuilding(
            BuildingType.StorageArea,
            (await gp.actions.findBuildableTile(BuildingType.StorageArea))!.x,
            (await gp.actions.findBuildableTile(BuildingType.StorageArea))!.y
        );
        await gp.wait.waitForFrames(5);

        await gp.resetGameState();
        await gp.resetGameState();

        await expect(gp).toHaveBuildingCount(0);
        checkErrors();
    });

    test('entities can be placed after reset', async ({ gp }) => {
        // Place, reset, place again — verifies systems are in clean state
        const tile1 = await gp.actions.findBuildableTile(BuildingType.WoodcutterHut);
        if (!tile1) {
            test.skip();
            return;
        }
        await gp.actions.placeBuilding(BuildingType.WoodcutterHut, tile1.x, tile1.y);
        await expect(gp).toHaveBuildingCount(1);

        await gp.resetGameState();
        await expect(gp).toHaveBuildingCount(0);

        const tile2 = await gp.actions.findBuildableTile(BuildingType.WoodcutterHut);
        if (!tile2) {
            test.skip();
            return;
        }
        await gp.actions.placeBuilding(BuildingType.WoodcutterHut, tile2.x, tile2.y);
        await expect(gp).toHaveBuildingCount(1);

        await gp.actions.spawnUnit('Carrier');
        await gp.wait.waitForUnitCount(1, Timeout.DEFAULT);
    });
});

import { test, expect } from './fixtures';

/**
 * E2E tests for the carrier logistics system (Wave 2 integration).
 *
 * Tests verify the integration of:
 * - Service area creation for residence/storage buildings
 * - Building inventory system
 * - Resource request tracking
 * - Carrier registration
 *
 * All game state queries go through GamePage helpers.
 * Uses sequential tests to avoid shared fixture issues.
 */

test.describe.serial('Carrier Logistics System', () => {
    test('residence creates service area', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile(29); // ResidenceSmall
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(29, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();

        const hasArea = await gp.hasServiceArea(building!.id);
        expect(hasArea).toBe(true);
    });

    test('sawmill gets inventory', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile(3); // Sawmill
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(3, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();

        const hasInv = await gp.hasInventory(building!.id);
        expect(hasInv).toBe(true);
    });

    test('carrier registration', async({ gp }) => {
        // Place a hub building (residence with service area)
        const hubTile = await gp.findBuildableTile(29);
        if (!hubTile) {
            test.skip();
            return;
        }

        const hub = await gp.placeBuilding(29, hubTile.x, hubTile.y);
        expect(hub).not.toBeNull();

        // Spawn carrier near the hub (so it gets auto-registered)
        const carrier = await gp.spawnUnit(0, hubTile.x + 2, hubTile.y + 2);
        expect(carrier).not.toBeNull();

        const carrierState = await gp.getCarrierState(carrier!.id);
        expect(carrierState).not.toBeNull();
        expect(carrierState!.homeBuilding).toBeDefined();
        expect(carrierState!.hasJob).toBe(false);
    });

    test('resource request creation', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile(3); // Sawmill
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(3, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();

        const request = await gp.addResourceRequest(building!.id, 0, 4); // 0 = LOG
        expect(request).not.toBeNull();
        expect(request!.materialType).toBe(0); // LOG
        expect(request!.amount).toBe(4);
        expect(request!.isPending).toBe(true);
    });
});

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
 * Uses sequential tests to avoid shared fixture issues.
 */

test.describe.serial('Carrier Logistics System', () => {
    /**
     * Test that ResidenceSmall creates a service area on placement.
     */
    test('residence creates service area', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile(29); // ResidenceSmall
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(29, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();

        // Check service area was created
        const hasServiceArea = await gp.page.evaluate((buildingId) => {
            const game = (window as any).__settlers_game__;
            const area = game?.state.serviceAreaManager.getServiceArea(buildingId);
            return area !== null && area !== undefined;
        }, building!.id);

        expect(hasServiceArea).toBe(true);
    });

    /**
     * Test that production buildings get inventory.
     */
    test('sawmill gets inventory', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile(3); // Sawmill
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(3, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();

        // Check inventory was created
        const hasInventory = await gp.page.evaluate((buildingId) => {
            const game = (window as any).__settlers_game__;
            const inv = game?.state.inventoryManager.getInventory(buildingId);
            return inv !== null && inv !== undefined;
        }, building!.id);

        expect(hasInventory).toBe(true);
    });

    /**
     * Test carrier registration with a building.
     */
    test('carrier registration', async({ gp }) => {
        // Place a hub building
        const hubTile = await gp.findBuildableTile(29);
        if (!hubTile) {
            test.skip();
            return;
        }

        const hub = await gp.placeBuilding(29, hubTile.x, hubTile.y);
        expect(hub).not.toBeNull();

        // Spawn carrier and register it
        const result = await gp.page.evaluate(({ hubId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            // Spawn a carrier
            const maxIdBefore = Math.max(...game.state.entities.map((e: any) => e.id), 0);
            game.execute({
                type: 'spawn_unit',
                unitType: 0, // Carrier
                x: Math.floor(game.mapSize.width / 2),
                y: Math.floor(game.mapSize.height / 2),
                player: 0,
            });

            const carrier = game.state.entities.find((e: any) =>
                e.id > maxIdBefore && e.type === 1 && e.subType === 0
            );
            if (!carrier) return { error: 'carrier spawn failed' };

            // Register with hub
            game.state.carrierManager.createCarrier(carrier.id, hubId);
            const state = game.state.carrierManager.getCarrier(carrier.id);

            return {
                carrierId: carrier.id,
                homeBuilding: state?.homeBuilding,
                hasNoJob: state?.currentJob === null,
            };
        }, { hubId: hub!.id });

        expect(result).not.toHaveProperty('error');
        expect(result.homeBuilding).toBe(hub!.id);
        expect(result.hasNoJob).toBe(true);
    });

    /**
     * Test resource request creation.
     */
    test('resource request creation', async({ gp }) => {
        const buildableTile = await gp.findBuildableTile(3); // Sawmill
        if (!buildableTile) {
            test.skip();
            return;
        }

        const building = await gp.placeBuilding(3, buildableTile.x, buildableTile.y);
        expect(building).not.toBeNull();

        // Create request and check it's tracked
        const result = await gp.page.evaluate(({ buildingId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const request = game.state.requestManager.addRequest(
                buildingId,
                0, // EMaterialType.LOG
                4,
                1, // priority
            );

            const pending = game.state.requestManager.getPendingRequests();
            const found = pending.some((r: any) => r.id === request.id);

            return {
                requestId: request.id,
                materialType: request.materialType,
                amount: request.amount,
                isPending: found,
            };
        }, { buildingId: building!.id });

        expect(result).not.toHaveProperty('error');
        expect(result.materialType).toBe(0); // LOG
        expect(result.amount).toBe(4);
        expect(result.isPending).toBe(true);
    });
});

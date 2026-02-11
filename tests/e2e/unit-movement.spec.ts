import { test, expect } from './fixtures';

/**
 * E2E tests for unit movement system.
 * Verifies movement starts immediately, is smooth, and consistent across multiple units.
 *
 * All game state queries go through GamePage helpers.
 * Uses the shared testMap fixture — the map is loaded once per worker,
 * and game state is reset between tests via resetGameState().
 */

test.describe('Unit Movement', { tag: '@smoke' }, () => {
    test('unit starts moving immediately after command and completes path', async({ gp }) => {
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 3;
        const targetY = unit!.y;

        const ok = await gp.moveUnit(unit!.id, targetX, targetY);
        expect(ok).toBe(true);

        await test.step('path is computed immediately', async() => {
            const unitState = await gp.getUnitState(unit!.id);
            expect(unitState).not.toBeNull();
            expect(unitState!.pathLength).toBeGreaterThan(0);
        });

        await test.step('unit moves away from start', async() => {
            await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 8000);
        });

        await test.step('unit reaches destination and becomes stationary', async() => {
            await gp.waitForUnitAtDestination(unit!.id, targetX, targetY, 10000);

            const unitState = await gp.getUnitState(unit!.id);
            expect(unitState).not.toBeNull();
            expect(unitState!.pathLength).toBe(0);

            const entities = await gp.getEntities({ type: 1 });
            const finalUnit = entities.find(e => e.id === unit!.id);
            expect(finalUnit).toBeDefined();
            expect(finalUnit!.x).toBe(targetX);
            expect(finalUnit!.y).toBe(targetY);
        });
    });

    test('unit movement is smooth (no teleporting)', { tag: '@slow' }, async({ gp }) => {
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move 5 tiles east
        const ok = await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        expect(ok).toBe(true);

        // Wait for movement to start
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 8000);

        // Sample positions across frames
        const positions = await gp.sampleUnitPositions(unit!.id, 10);
        expect(positions.length).toBeGreaterThan(3);

        // Verify no large jumps (teleporting) - max 2 tiles per sample
        for (let i = 1; i < positions.length; i++) {
            const dx = Math.abs(positions[i].x - positions[i - 1].x);
            const dy = Math.abs(positions[i].y - positions[i - 1].y);
            expect(dx).toBeLessThanOrEqual(2);
            expect(dy).toBeLessThanOrEqual(2);
        }
    });

    test('multiple units move at consistent speeds', async({ gp }) => {
        const center = await gp.getMapCenter();

        // Spawn 3 units at nearby positions
        const units: Array<{ id: number; x: number; y: number }> = [];
        for (let i = 0; i < 3; i++) {
            const unit = await gp.spawnUnit(1, center.x + i * 2, center.y);
            if (unit) units.push(unit);
        }
        expect(units.length).toBe(3);

        // Issue simultaneous move commands
        const targetX = center.x + 10;
        for (const u of units) {
            await gp.moveUnit(u.id, targetX, center.y);
        }

        // Wait for all units to start moving
        await gp.waitForUnitsMoving(3, 10000);

        // Let them move for a bit
        await gp.waitForFrames(10, 5000);

        // Check that all units have moved from their start positions
        const finalEntities = await gp.getEntities({ type: 1 });
        const distances: number[] = [];
        for (const init of units) {
            const final = finalEntities.find(e => e.id === init.id);
            if (final) {
                const dx = final.x - init.x;
                const dy = final.y - init.y;
                distances.push(Math.sqrt(dx * dx + dy * dy));
            }
        }

        expect(distances.length).toBe(3);
        for (const dist of distances) {
            expect(dist).toBeGreaterThan(0);
        }

        // Distances should be similar (within 4 tiles of each other)
        const maxDist = Math.max(...distances);
        const minDist = Math.min(...distances);
        expect(maxDist - minDist).toBeLessThan(4);
    });

    test('movement command while already moving updates path correctly', async({ gp }) => {
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await test.step('start initial movement east', async() => {
            await gp.moveUnit(unit!.id, unit!.x + 10, unit!.y);
            await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 8000);
        });

        // Capture position before redirect
        const entitiesBeforeRedirect = await gp.getEntities({ type: 1 });
        const posBeforeRedirect = entitiesBeforeRedirect.find(e => e.id === unit!.id)!;

        await test.step('redirect south and verify new path', async() => {
            const newTargetY = unit!.y + 5;
            await gp.moveUnit(unit!.id, posBeforeRedirect.x, newTargetY);

            const unitState = await gp.getUnitState(unit!.id);
            expect(unitState).not.toBeNull();
            expect(unitState!.pathLength).toBeGreaterThan(0);
            expect(unitState!.moveProgress).toBeGreaterThanOrEqual(0);
        });

        await test.step('unit moves south after redirect', async() => {
            await gp.waitForFrames(15, 5000);

            const entities = await gp.getEntities({ type: 1 });
            const finalUnit = entities.find(e => e.id === unit!.id);
            expect(finalUnit).toBeDefined();
            expect(finalUnit!.y).toBeGreaterThan(posBeforeRedirect.y);
        });
    });

    test('debug stats show moving units count', async({ gp }) => {
        // Initially no user-placed units
        await expect(gp).toHaveUnitCount(0);
        await expect(gp).toHaveUnitsMoving(0);

        // Spawn and move a unit using helpers
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);

        // Wait for unitsMoving to be at least 1
        await gp.waitForUnitsMoving(1, 5000);
    });
});

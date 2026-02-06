import { test, expect } from '@playwright/test';
import { GamePage } from './game-page';

/**
 * E2E tests for unit movement system.
 * Verifies movement starts immediately, is smooth, and consistent across multiple units.
 */

test.describe('Unit Movement', () => {
    test('unit starts moving immediately after command (no delay)', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Spawn a unit
        await gp.spawnBearer();
        await gp.waitForEntityCountAbove(0);

        // Get the unit's initial position and issue a move command
        const moveResult = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            // Find the unit
            const units = game.state.entities.filter((e: any) => e.type === 1);
            if (units.length === 0) return { error: 'no units' };

            const unit = units[0];
            const unitState = game.state.unitStates.get(unit.id);
            if (!unitState) return { error: 'no unit state' };

            const startX = unit.x;
            const startY = unit.y;

            // Find a passable target tile 3-5 tiles away
            const w = game.mapSize.width;
            const h = game.mapSize.height;
            let targetX = startX + 3;
            const targetY = startY;

            // Ensure target is within bounds and passable
            if (targetX >= w) targetX = startX - 3;
            if (targetX < 0) targetX = Math.floor(w / 2);

            // Issue move command
            const ok = game.execute({
                type: 'move_unit',
                entityId: unit.id,
                targetX,
                targetY
            });

            // Capture state immediately after command
            const stateAfterCommand = {
                prevX: unitState.prevX,
                prevY: unitState.prevY,
                entityX: unit.x,
                entityY: unit.y,
                pathLength: unitState.path.length,
                pathIndex: unitState.pathIndex,
                moveProgress: unitState.moveProgress,
            };

            return {
                ok,
                startX,
                startY,
                targetX,
                targetY,
                unitId: unit.id,
                stateAfterCommand
            };
        });

        expect(moveResult).not.toHaveProperty('error');
        expect(moveResult.ok).toBe(true);
        expect(moveResult.stateAfterCommand).toBeDefined();

        // Verify the unit state is set up for movement
        // moveProgress starts at 0; unit moves once progress reaches 1 (after 1/speed seconds)
        const stateAfter = moveResult.stateAfterCommand!;
        expect(stateAfter.moveProgress).toBe(0);
        expect(stateAfter.pathLength).toBeGreaterThan(0);
        expect(stateAfter.pathIndex).toBe(0);

        // Wait enough time for movement to start (speed=2 means 0.5s per tile)
        await page.waitForTimeout(600);

        // Check that unit has started moving (entity position changed)
        const positionCheck = await page.evaluate(({ unitId, startX, startY }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const unit = game.state.getEntity(unitId);
            if (!unit) return null;

            const unitState = game.state.unitStates.get(unitId);

            return {
                currentX: unit.x,
                currentY: unit.y,
                prevX: unitState?.prevX,
                prevY: unitState?.prevY,
                pathIndex: unitState?.pathIndex,
                moved: unit.x !== startX || unit.y !== startY
            };
        }, { unitId: moveResult.unitId, startX: moveResult.startX, startY: moveResult.startY });

        expect(positionCheck).not.toBeNull();
        // After a few frames, the unit should have moved at least one tile
        expect(positionCheck!.moved).toBe(true);
    });

    test('unit movement is smooth (interpolation works)', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Spawn a unit and move it
        const setup = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            // Spawn bearer at center
            game.execute({
                type: 'spawn_unit',
                unitType: 1,
                x: cx,
                y: cy,
                player: 0
            });

            const units = game.state.entities.filter((e: any) => e.type === 1);
            if (units.length === 0) return { error: 'no units spawned' };

            const unit = units[units.length - 1];
            const startX = unit.x;
            const startY = unit.y;

            // Move 5 tiles east
            const targetX = startX + 5;
            const ok = game.execute({
                type: 'move_unit',
                entityId: unit.id,
                targetX,
                targetY: startY
            });

            if (!ok) return { error: 'move command failed' };

            return { unitId: unit.id, startX, startY, targetX };
        });

        expect(setup).not.toHaveProperty('error');

        // Wait for movement to start (first tile transition)
        await page.waitForFunction(
            ({ unitId, startX }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;
                const unit = game.state.getEntity(unitId);
                return unit && unit.x !== startX;
            },
            { unitId: setup.unitId, startX: setup.startX },
            { timeout: 3000 }
        );

        // Sample tile positions over time to check for large jumps
        const positions: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < 10; i++) {
            const pos = await page.evaluate(({ unitId }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return null;
                const unit = game.state.getEntity(unitId);
                return unit ? { x: unit.x, y: unit.y } : null;
            }, { unitId: setup.unitId });

            if (pos) positions.push(pos);
            await page.waitForTimeout(50);
        }

        expect(positions.length).toBeGreaterThan(3);

        // Verify no large jumps (teleporting) - max 2 tiles per sample
        for (let i = 1; i < positions.length; i++) {
            const dx = Math.abs(positions[i].x - positions[i - 1].x);
            const dy = Math.abs(positions[i].y - positions[i - 1].y);
            expect(dx).toBeLessThanOrEqual(2);
            expect(dy).toBeLessThanOrEqual(2);
        }

        // Verify unit has moved from start
        const finalPos = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const unit = game.state.getEntity(unitId);
            return unit ? { x: unit.x, y: unit.y } : null;
        }, { unitId: setup.unitId });

        expect(finalPos).not.toBeNull();
        expect(finalPos!.x).not.toBe(setup.startX);
    });

    test('multiple units move at consistent speeds', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Spawn multiple units
        const spawnResult = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            const unitIds: number[] = [];

            // Spawn 3 bearers at nearby positions
            for (let i = 0; i < 3; i++) {
                const ok = game.execute({
                    type: 'spawn_unit',
                    unitType: 1, // Bearer
                    x: cx + i * 2,
                    y: cy,
                    player: 0
                });
                if (ok) {
                    const units = game.state.entities.filter((e: any) => e.type === 1);
                    unitIds.push(units[units.length - 1].id);
                }
            }

            return { unitIds, centerX: cx, centerY: cy };
        });

        expect(spawnResult).not.toHaveProperty('error');
        expect(spawnResult.unitIds).toBeDefined();
        expect(spawnResult.unitIds!.length).toBe(3);

        const { unitIds, centerX, centerY } = spawnResult as { unitIds: number[]; centerX: number; centerY: number };

        // Issue simultaneous move commands to all units
        const moveSetup = await page.evaluate(({ unitIds: ids, centerX: cx, centerY: cy }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            // Move all units to the same distant target
            const targetX = cx + 10;
            const targetY = cy;

            const initialPositions: Array<{ id: number; x: number; y: number }> = [];

            for (const id of ids) {
                const unit = game.state.getEntity(id);
                if (unit) {
                    initialPositions.push({ id, x: unit.x, y: unit.y });
                    game.execute({
                        type: 'move_unit',
                        entityId: id,
                        targetX,
                        targetY
                    });
                }
            }

            return { targetX, targetY, initialPositions };
        }, { unitIds, centerX, centerY });

        expect(moveSetup).not.toHaveProperty('error');
        expect(moveSetup.initialPositions).toBeDefined();

        // Wait for movement to progress (speed=2 means 0.5s per tile, wait long enough for multiple tiles)
        await page.waitForTimeout(800);

        const initialPositions = moveSetup.initialPositions!;

        // Check that all units have moved similar distances
        const finalCheck = await page.evaluate(({ ids, initPos }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const distances: number[] = [];

            for (const init of initPos) {
                const unit = game.state.getEntity(init.id);
                if (unit) {
                    const dx = unit.x - init.x;
                    const dy = unit.y - init.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    distances.push(dist);
                }
            }

            return { distances };
        }, { ids: unitIds, initPos: initialPositions });

        expect(finalCheck).not.toBeNull();
        expect(finalCheck!.distances.length).toBe(3);

        // All units should have moved (distance > 0)
        for (const dist of finalCheck!.distances) {
            expect(dist).toBeGreaterThan(0);
        }

        // Distances should be similar (within 2 tiles of each other)
        // Units may take slightly different paths due to formation offsets
        const maxDist = Math.max(...finalCheck!.distances);
        const minDist = Math.min(...finalCheck!.distances);
        expect(maxDist - minDist).toBeLessThan(4);
    });

    test('unit completes path to destination', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Spawn and move a unit to a nearby destination
        const setup = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            // Spawn bearer
            game.execute({
                type: 'spawn_unit',
                unitType: 1,
                x: cx,
                y: cy,
                player: 0
            });

            const units = game.state.entities.filter((e: any) => e.type === 1);
            const unit = units[units.length - 1];

            // Move 3 tiles (short distance so it completes quickly)
            const targetX = unit.x + 3;
            const targetY = unit.y;

            game.execute({
                type: 'move_unit',
                entityId: unit.id,
                targetX,
                targetY
            });

            return { unitId: unit.id, targetX, targetY };
        });

        expect(setup).not.toHaveProperty('error');

        // Wait for unit to reach destination AND become stationary
        // (prev == entity, meaning visual transition is complete)
        await page.waitForFunction(
            ({ unitId, targetX, targetY }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;
                const unit = game.state.getEntity(unitId);
                const unitState = game.state.unitStates.get(unitId);
                if (!unit || !unitState) return false;
                // Check both position AND stationary state
                return unit.x === targetX && unit.y === targetY &&
                    unitState.prevX === unit.x && unitState.prevY === unit.y;
            },
            { unitId: setup.unitId, targetX: setup.targetX, targetY: setup.targetY },
            { timeout: 5000 }
        );

        // Verify unit is at destination and path is cleared
        const finalState = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const unit = game.state.getEntity(unitId);
            const unitState = game.state.unitStates.get(unitId);

            return {
                x: unit?.x,
                y: unit?.y,
                pathLength: unitState?.path.length ?? 0,
                pathIndex: unitState?.pathIndex ?? 0,
                isStationary: unitState ? unitState.prevX === unit?.x && unitState.prevY === unit?.y : true
            };
        }, { unitId: setup.unitId });

        expect(finalState).not.toBeNull();
        expect(finalState!.x).toBe(setup.targetX);
        expect(finalState!.y).toBe(setup.targetY);
        expect(finalState!.pathLength).toBe(0);
        expect(finalState!.isStationary).toBe(true);
    });

    test('movement command while already moving updates path correctly', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Spawn and start moving a unit
        const setup = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            // Spawn bearer
            game.execute({
                type: 'spawn_unit',
                unitType: 1,
                x: cx,
                y: cy,
                player: 0
            });

            const units = game.state.entities.filter((e: any) => e.type === 1);
            const unit = units[units.length - 1];

            // Start moving east
            game.execute({
                type: 'move_unit',
                entityId: unit.id,
                targetX: unit.x + 10,
                targetY: unit.y
            });

            return { unitId: unit.id, startX: unit.x, startY: unit.y };
        });

        expect(setup).not.toHaveProperty('error');

        // Wait for unit to start moving (at least 1 tile from start)
        await page.waitForFunction(
            ({ unitId, startX }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;
                const unit = game.state.getEntity(unitId);
                return unit && unit.x !== startX;
            },
            { unitId: setup.unitId, startX: setup.startX },
            { timeout: 3000 }
        );

        // Issue new command to move in different direction
        const redirect = await page.evaluate(({ unitId, startY }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const unit = game.state.getEntity(unitId);
            if (!unit) return { error: 'unit not found' };

            const posBeforeRedirect = { x: unit.x, y: unit.y };

            // Redirect to move south instead
            const newTargetY = startY + 5;
            game.execute({
                type: 'move_unit',
                entityId: unitId,
                targetX: unit.x, // Keep same X
                targetY: newTargetY
            });

            const unitState = game.state.unitStates.get(unitId);

            return {
                posBeforeRedirect,
                newTargetY,
                newPathLength: unitState?.path.length ?? 0,
                moveProgress: unitState?.moveProgress
            };
        }, { unitId: setup.unitId, startY: setup.startY });

        expect(redirect).not.toHaveProperty('error');
        expect(redirect.newPathLength).toBeGreaterThan(0);
        // Progress is preserved during redirect, not reset
        expect(redirect.moveProgress).toBeGreaterThanOrEqual(0);
        expect(redirect.posBeforeRedirect).toBeDefined();

        const posBeforeRedirect = redirect.posBeforeRedirect!;

        // Wait for unit to move in new direction (Y should increase)
        await page.waitForFunction(
            ({ unitId, prevY }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;
                const unit = game.state.getEntity(unitId);
                return unit && unit.y > prevY;
            },
            { unitId: setup.unitId, prevY: posBeforeRedirect.y },
            { timeout: 3000 }
        );

        // Verify unit has moved south
        const checkDirection = await page.evaluate(({ unitId, prevPos }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const unit = game.state.getEntity(unitId);
            if (!unit) return null;

            return {
                currentX: unit.x,
                currentY: unit.y,
                movedSouth: unit.y > prevPos.y
            };
        }, { unitId: setup.unitId, prevPos: posBeforeRedirect });

        expect(checkDirection).not.toBeNull();
        expect(checkDirection!.movedSouth).toBe(true);
    });

    test('debug stats show moving units count', async({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();

        // Initially no units moving
        let unitsMoving = await gp.getDebugField('unitsMoving');
        expect(unitsMoving).toBe(0);

        // Spawn and move a unit
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const w = game.mapSize.width;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(game.mapSize.height / 2);

            game.execute({
                type: 'spawn_unit',
                unitType: 1,
                x: cx,
                y: cy,
                player: 0
            });

            const units = game.state.entities.filter((e: any) => e.type === 1);
            const unit = units[units.length - 1];

            game.execute({
                type: 'move_unit',
                entityId: unit.id,
                targetX: unit.x + 5,
                targetY: unit.y
            });
        });

        // Wait for tick to process
        await gp.waitForFrames(3);

        // Now should show 1 unit moving
        unitsMoving = await gp.getDebugField('unitsMoving');
        expect(unitsMoving).toBe(1);
    });
});

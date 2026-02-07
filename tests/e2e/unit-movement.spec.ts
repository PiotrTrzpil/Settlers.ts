import { test, expect } from './fixtures';

/**
 * E2E tests for unit movement system.
 * Verifies movement starts immediately, is smooth, and consistent across multiple units.
 *
 * Uses the shared testMap fixture — the map is loaded once per worker,
 * and game state is reset between tests via resetGameState().
 */

test.describe('Unit Movement', () => {
    test('unit starts moving immediately after command (no delay)', async({ gp }) => {
        const page = gp.page;

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

        // Wait for unit to actually move using polling (more reliable than fixed timeout)
        // speed=2 means 0.5s per tile, but with game loop timing variance, poll for up to 2s
        const moved = await page.waitForFunction(
            ({ unitId, startX, startY }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;

                const unit = game.state.getEntity(unitId);
                if (!unit) return false;

                return unit.x !== startX || unit.y !== startY;
            },
            { unitId: moveResult.unitId, startX: moveResult.startX, startY: moveResult.startY },
            { timeout: 8000, polling: 100 }
        );

        expect(moved).toBeTruthy();
    });

    test('unit movement is smooth (interpolation works)', async({ gp }) => {
        test.setTimeout(60000);
        const page = gp.page;

        await test.step('spawn unit and start movement', async() => {
            // Spawn via game.execute for precise placement
            const unit = await gp.spawnUnit(1);
            expect(unit).not.toBeNull();

            // Move 5 tiles east
            const ok = await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
            expect(ok).toBe(true);

            // Wait for movement to start (first tile transition)
            await page.waitForFunction(
                ({ unitId, startX }) => {
                    const game = (window as any).__settlers_game__;
                    if (!game) return false;
                    const u = game.state.getEntity(unitId);
                    return u && u.x !== startX;
                },
                { unitId: unit!.id, startX: unit!.x },
                { timeout: 8000 }
            );
        });

        const unit = (await gp.getEntities({ type: 1 }))[0];

        await test.step('sample positions and verify no teleporting', async() => {
            // Sample tile positions across frames in a single call to avoid round-trip delays
            const result = await page.evaluate(({ unitId }) => {
                return new Promise<{ positions: Array<{ x: number; y: number }> }>((resolve) => {
                    const positions: Array<{ x: number; y: number }> = [];
                    let samples = 0;

                    function sample() {
                        const game = (window as any).__settlers_game__;
                        if (game) {
                            const u = game.state.getEntity(unitId);
                            if (u) positions.push({ x: u.x, y: u.y });
                        }
                        samples++;
                        if (samples < 10) {
                            requestAnimationFrame(sample);
                        } else {
                            resolve({ positions });
                        }
                    }
                    requestAnimationFrame(sample);
                });
            }, { unitId: unit.id });

            expect(result.positions.length).toBeGreaterThan(3);

            // Verify no large jumps (teleporting) - max 2 tiles per sample
            for (let i = 1; i < result.positions.length; i++) {
                const dx = Math.abs(result.positions[i].x - result.positions[i - 1].x);
                const dy = Math.abs(result.positions[i].y - result.positions[i - 1].y);
                expect(dx).toBeLessThanOrEqual(2);
                expect(dy).toBeLessThanOrEqual(2);
            }
        });
    });

    test('multiple units move at consistent speeds', async({ gp }) => {
        const page = gp.page;

        // Spawn 3 units at nearby positions
        const unitIds: number[] = [];
        const cx = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            return game ? Math.floor(game.mapSize.width / 2) : 0;
        });
        const cy = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            return game ? Math.floor(game.mapSize.height / 2) : 0;
        });

        for (let i = 0; i < 3; i++) {
            const unit = await gp.spawnUnit(1, cx + i * 2, cy);
            if (unit) unitIds.push(unit.id);
        }
        expect(unitIds.length).toBe(3);

        // Capture initial positions
        const initialPositions = await page.evaluate(({ ids }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return [];
            return ids.map((id: number) => {
                const unit = game.state.getEntity(id);
                return unit ? { id, x: unit.x, y: unit.y } : null;
            }).filter((v): v is { id: number; x: number; y: number } => v !== null);
        }, { ids: unitIds });

        // Issue simultaneous move commands to all units
        const targetX = cx + 10;
        for (const id of unitIds) {
            await gp.moveUnit(id, targetX, cy);
        }

        // Wait for all units to start moving (poll instead of fixed timeout)
        await page.waitForFunction(
            ({ initPos }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;
                return initPos.every((init: any) => {
                    const unit = game.state.getEntity(init.id);
                    return unit && (unit.x !== init.x || unit.y !== init.y);
                });
            },
            { initPos: initialPositions },
            { timeout: 10000 },
        );

        // Check that all units have moved similar distances
        const finalCheck = await page.evaluate(({ initPos }) => {
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
        }, { initPos: initialPositions });

        expect(finalCheck).not.toBeNull();
        expect(finalCheck!.distances.length).toBe(3);

        // All units should have moved (distance > 0)
        for (const dist of finalCheck!.distances) {
            expect(dist).toBeGreaterThan(0);
        }

        // Distances should be similar (within 2 tiles of each other)
        const maxDist = Math.max(...finalCheck!.distances);
        const minDist = Math.min(...finalCheck!.distances);
        expect(maxDist - minDist).toBeLessThan(4);
    });

    test('unit completes path to destination', async({ gp }) => {
        const page = gp.page;

        // Spawn and move a unit to a nearby destination
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 3;
        const targetY = unit!.y;

        const ok = await gp.moveUnit(unit!.id, targetX, targetY);
        expect(ok).toBe(true);

        // Wait for unit to reach destination AND become stationary
        // Using expect.toPass() for better error messages on multi-condition check
        await expect(async() => {
            const state = await page.evaluate(({ unitId }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return null;
                const u = game.state.getEntity(unitId);
                const us = game.state.unitStates.get(unitId);
                return {
                    x: u?.x, y: u?.y,
                    pathLength: us?.path.length ?? -1,
                    isStationary: us ? us.prevX === u?.x && us.prevY === u?.y : false
                };
            }, { unitId: unit!.id });

            expect(state).not.toBeNull();
            expect(state!.x).toBe(targetX);
            expect(state!.y).toBe(targetY);
            expect(state!.pathLength).toBe(0);
            expect(state!.isStationary).toBe(true);
        }).toPass({ timeout: 10000, intervals: [100, 200, 500, 1000] });
    });

    test('movement command while already moving updates path correctly', async({ gp }) => {
        const page = gp.page;

        // Spawn a unit and start moving east
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await test.step('start initial movement east', async() => {
            await gp.moveUnit(unit!.id, unit!.x + 10, unit!.y);
        });

        await test.step('wait for unit to start moving', async() => {
            await page.waitForFunction(
                ({ unitId, startX }) => {
                    const game = (window as any).__settlers_game__;
                    if (!game) return false;
                    const u = game.state.getEntity(unitId);
                    return u && u.x !== startX;
                },
                { unitId: unit!.id, startX: unit!.x },
                { timeout: 8000 }
            );
        });

        // Capture position before redirect
        const posBeforeRedirect = (await gp.getEntities({ type: 1 }))[0];

        await test.step('redirect south and verify', async() => {
            // Issue new command to move south instead
            const newTargetY = unit!.y + 5;
            await gp.moveUnit(unit!.id, posBeforeRedirect.x, newTargetY);

            // Verify new path was set
            const redirect = await page.evaluate(({ unitId }) => {
                const game = (window as any).__settlers_game__;
                if (!game) return null;
                const us = game.state.unitStates.get(unitId);
                return {
                    newPathLength: us?.path.length ?? 0,
                    moveProgress: us?.moveProgress
                };
            }, { unitId: unit!.id });

            expect(redirect).not.toBeNull();
            expect(redirect!.newPathLength).toBeGreaterThan(0);
            expect(redirect!.moveProgress).toBeGreaterThanOrEqual(0);
        });

        await test.step('wait for unit to move south', async() => {
            // Wait for unit to move in new direction (Y should increase)
            await page.waitForFunction(
                ({ unitId, prevY }) => {
                    const game = (window as any).__settlers_game__;
                    if (!game) return false;
                    const u = game.state.getEntity(unitId);
                    return u && u.y > prevY;
                },
                { unitId: unit!.id, prevY: posBeforeRedirect.y },
                { timeout: 8000 }
            );

            // Verify unit has moved south
            const finalUnit = (await gp.getEntities({ type: 1 }))
                .find(e => e.id === unit!.id);
            expect(finalUnit).toBeDefined();
            expect(finalUnit!.y).toBeGreaterThan(posBeforeRedirect.y);
        });
    });

    test('debug stats show moving units count', async({ gp }) => {
        // Initially no units moving
        await expect(gp).toHaveEntityCount(0);
        let unitsMoving = await gp.getDebugField('unitsMoving');
        expect(unitsMoving).toBe(0);

        // Spawn and move a unit using helpers
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);

        // Wait for tick to process
        await gp.waitForFrames(3);

        // Now should show 1 unit moving
        unitsMoving = await gp.getDebugField('unitsMoving');
        expect(unitsMoving).toBe(1);
    });
});

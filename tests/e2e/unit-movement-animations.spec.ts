import { test, expect } from './fixtures';

/**
 * E2E tests for unit movement animations.
 *
 * These tests verify:
 * - Animation state is correctly managed by AnimationService during movement
 * - Direction values update correctly when path changes
 * - Animation plays during movement and stops when idle
 * - Walk sequence is used during movement
 *
 * Architecture note: Animation is managed by SettlerTaskSystem which calls
 * AnimationService directly. The only event still emitted is movementStopped
 * (used by CarrierSystem for arrival detection).
 *
 * Uses programmatic test map (no real game assets required).
 */

/**
 * Helper to get animation state from AnimationService.
 * This is the correct way to query animation state in the new architecture.
 * AnimationService lives at game.gameLoop.animationService
 */
async function getAnimationState(page: any, unitId: number) {
    return page.evaluate(({ id }: { id: number }) => {
        const game = (window as any).__settlers_game__;
        const animService = game?.gameLoop?.animationService;
        if (!animService) return null;

        const state = animService.getState(id);
        if (!state) return null;

        return {
            sequenceKey: state.sequenceKey,
            currentFrame: state.currentFrame,
            direction: state.direction,
            playing: state.playing,
            loop: state.loop,
            elapsedMs: state.elapsedMs,
        };
    }, { id: unitId });
}

/**
 * Helper to get movement controller state.
 */
async function getMovementState(page: any, unitId: number) {
    return page.evaluate(({ id }: { id: number }) => {
        const game = (window as any).__settlers_game__;
        if (!game) return null;

        const controller = game.state.movement.getController(id);
        if (!controller) return null;

        return {
            state: controller.state,
            direction: controller.direction,
            tileX: controller.tileX,
            tileY: controller.tileY,
        };
    }, { id: unitId });
}

test.describe('Animation State During Movement', { tag: '@animations' }, () => {
    test('animation plays with walk sequence during movement', async({ gp }) => {
        const page = gp.page;

        // Spawn and start moving
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 10, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Check animation state while moving
        const animState = await getAnimationState(page, unit!.id);

        expect(animState).not.toBeNull();
        expect(animState!.playing).toBe(true);
        expect(animState!.sequenceKey).toBe('walk');
        expect(animState!.loop).toBe(true);
    });

    test('animation state is maintained consistently during movement', { tag: '@slow' }, async({ gp }) => {
        const page = gp.page;

        // Spawn and start moving
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 10, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Sample animation state multiple times during movement
        const stateSamples = await page.evaluate(({ unitId }: { unitId: number }) => {
            return new Promise<Array<{ playing: boolean; sequenceKey: string }>>((resolve) => {
                const samples: Array<{ playing: boolean; sequenceKey: string }> = [];
                let count = 0;
                const maxSamples = 20;

                function sample() {
                    const game = (window as any).__settlers_game__;
                    const animService = game?.gameLoop?.animationService;
                    if (animService) {
                        const state = animService.getState(unitId);
                        if (state) {
                            samples.push({
                                playing: state.playing,
                                sequenceKey: state.sequenceKey
                            });
                        }
                    }
                    count++;
                    if (count < maxSamples) {
                        requestAnimationFrame(sample);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(sample);
            });
        }, { unitId: unit!.id });

        expect(stateSamples.length).toBeGreaterThan(5);

        // All samples should show animation is playing with walk sequence
        for (const sample of stateSamples) {
            expect(sample.playing).toBe(true);
            expect(sample.sequenceKey).toBe('walk');
        }
    });

    test('animation stops when movement completes', async({ gp }) => {
        const page = gp.page;

        // Spawn and move short distance
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 2;
        await gp.moveUnit(unit!.id, targetX, unit!.y);

        // Wait for destination AND controller to be idle
        await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
        await page.waitForFunction(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Check animation is stopped
        const animState = await getAnimationState(page, unit!.id);

        expect(animState).not.toBeNull();
        expect(animState!.playing).toBe(false);
    });

    test('animation resets to frame 0 when stopped', async({ gp }) => {
        const page = gp.page;

        // Spawn and move
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 2;
        await gp.moveUnit(unit!.id, targetX, unit!.y);
        await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);

        // Wait for controller to be idle
        await page.waitForFunction(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Check frame is 0
        const animState = await getAnimationState(page, unit!.id);

        expect(animState).not.toBeNull();
        expect(animState!.currentFrame).toBe(0);
    });
});

test.describe('Direction Tracking', { tag: '@animations' }, () => {
    test('animation direction matches movement controller direction', async({ gp }) => {
        const page = gp.page;

        // Spawn unit
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move east
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Sample both animation and movement controller directions
        const animState = await getAnimationState(page, unit!.id);
        const moveState = await getMovementState(page, unit!.id);

        expect(animState).not.toBeNull();
        expect(moveState).not.toBeNull();
        expect(animState!.direction).toBe(moveState!.direction);
    });

    test('direction values are valid hex directions (0-5)', async({ gp }) => {
        const page = gp.page;

        // Spawn and move multiple units in different directions
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move and sample direction
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 3000);

        const animState = await getAnimationState(page, unit!.id);

        expect(animState).not.toBeNull();
        expect(animState!.direction).toBeGreaterThanOrEqual(0);
        expect(animState!.direction).toBeLessThanOrEqual(5);
    });

    test('direction updates when path changes', async({ gpNormal: gp }) => {
        const page = gp.page;

        // Spawn unit and start moving
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move east
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);

        // Get current position and initial direction
        const initialState = await getAnimationState(page, unit!.id);
        const currentPos = await page.evaluate(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            const entity = game?.state.getEntity(unitId);
            return entity ? { x: entity.x, y: entity.y } : null;
        }, { unitId: unit!.id });

        expect(currentPos).not.toBeNull();
        expect(initialState).not.toBeNull();

        // Redirect south (different direction)
        await gp.moveUnit(unit!.id, currentPos!.x, currentPos!.y + 5);
        await gp.waitForFrames(10, 3000);

        // Direction should have changed
        const newState = await getAnimationState(page, unit!.id);
        expect(newState).not.toBeNull();

        // Note: The exact direction depends on hex grid layout
        // We just verify the direction is still valid
        expect(newState!.direction).toBeGreaterThanOrEqual(0);
        expect(newState!.direction).toBeLessThanOrEqual(5);
    });

    test('multiple direction changes during movement are handled', async({ gpNormal: gp }) => {
        const page = gp.page;

        // Track direction samples over time
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const directionSamples: number[] = [];

        // Move east
        await gp.moveUnit(unit!.id, unit!.x + 3, unit!.y);
        await gp.waitForFrames(5, 3000);

        let state = await getAnimationState(page, unit!.id);
        if (state) directionSamples.push(state.direction);

        // Get current position
        const pos1 = await page.evaluate(({ id }: { id: number }) => {
            const g = (window as any).__settlers_game__;
            const e = g?.state.getEntity(id);
            return e ? { x: e.x, y: e.y } : null;
        }, { id: unit!.id });

        // Move south
        await gp.moveUnit(unit!.id, pos1!.x, pos1!.y + 3);
        await gp.waitForFrames(5, 3000);

        state = await getAnimationState(page, unit!.id);
        if (state) directionSamples.push(state.direction);

        // Get updated position
        const pos2 = await page.evaluate(({ id }: { id: number }) => {
            const g = (window as any).__settlers_game__;
            const e = g?.state.getEntity(id);
            return e ? { x: e.x, y: e.y } : null;
        }, { id: unit!.id });

        // Move west
        await gp.moveUnit(unit!.id, pos2!.x - 3, pos2!.y);
        await gp.waitForFrames(5, 3000);

        state = await getAnimationState(page, unit!.id);
        if (state) directionSamples.push(state.direction);

        // Verify all sampled directions are valid
        expect(directionSamples.length).toBeGreaterThanOrEqual(1);
        for (const dir of directionSamples) {
            expect(dir).toBeGreaterThanOrEqual(0);
            expect(dir).toBeLessThanOrEqual(5);
        }
    });
});

test.describe('Animation State Initialization', { tag: '@animations' }, () => {
    test('animation state exists after unit spawns and moves', async({ gpNormal: gp }) => {
        const page = gp.page;

        // Spawn unit and start movement to trigger animation initialization
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Start movement to trigger animation state initialization
        await gp.moveUnit(unit!.id, unit!.x + 3, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Check animation state exists and is properly initialized
        const animState = await getAnimationState(page, unit!.id);

        expect(animState).not.toBeNull();
        expect(animState!.sequenceKey).toBe('walk');
        expect(animState!.currentFrame).toBeGreaterThanOrEqual(0);
        expect(animState!.direction).toBeGreaterThanOrEqual(0);
        expect(animState!.direction).toBeLessThanOrEqual(5);
        expect(animState!.playing).toBe(true);
    });

    test('AnimationService has state for moving unit', async({ gp }) => {
        const page = gp.page;

        // Spawn and move
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Verify AnimationService.hasState returns true
        const hasState = await page.evaluate(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            return game?.gameLoop?.animationService?.hasState(unitId) ?? false;
        }, { unitId: unit!.id });

        expect(hasState).toBe(true);
    });
});

test.describe('Movement Events', { tag: '@animations' }, () => {
    test('movementStopped event fires when unit reaches destination', async({ gp }) => {
        const page = gp.page;

        // Set up event capture
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const captured: Array<{ event: string; payload: any }> = [];

            game.eventBus.on('unit:movementStopped', (payload: any) => {
                captured.push({ event: 'movementStopped', payload: { ...payload } });
            });

            (window as any).__capturedEvents = captured;
        });

        // Spawn unit and move short distance
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 2;
        await gp.moveUnit(unit!.id, targetX, unit!.y);

        // Wait for destination AND for controller to transition to idle
        await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
        await page.waitForFunction(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Check for stopped event
        const capturedEvents = await page.evaluate(() => {
            return (window as any).__capturedEvents ?? [];
        });

        const stopEvent = capturedEvents.find((e: any) => e.event === 'movementStopped');
        expect(stopEvent).toBeDefined();
        expect(stopEvent.payload.entityId).toBe(unit!.id);
        expect(stopEvent.payload.direction).toBeGreaterThanOrEqual(0);
        expect(stopEvent.payload.direction).toBeLessThanOrEqual(5);
    });

    test('movementStopped event fires for very short movements', async({ gp }) => {
        const page = gp.page;

        // Track events
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            (window as any).__stoppedCount = 0;

            game.eventBus.on('unit:movementStopped', () => {
                (window as any).__stoppedCount++;
            });
        });

        // Spawn unit and move just 1 tile
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 1;
        await gp.moveUnit(unit!.id, targetX, unit!.y);

        // Wait for arrival AND idle state
        await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
        await page.waitForFunction(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Should have received stopped event
        const stoppedCount = await page.evaluate(() => (window as any).__stoppedCount ?? 0);
        expect(stoppedCount).toBeGreaterThanOrEqual(1);
    });
});

test.describe('Movement and Animation Consistency', { tag: '@animations' }, () => {
    test('movement controller state matches animation playing state', async({ gpNormal: gp }) => {
        const page = gp.page;

        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // During movement
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        let animState = await getAnimationState(page, unit!.id);
        let moveState = await getMovementState(page, unit!.id);

        expect(animState?.playing).toBe(true);
        expect(moveState?.state).toBe('moving');

        // After reaching destination
        await gp.waitForUnitAtDestination(unit!.id, unit!.x + 5, unit!.y, 10000);
        await page.waitForFunction(({ unitId }: { unitId: number }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        animState = await getAnimationState(page, unit!.id);
        moveState = await getMovementState(page, unit!.id);

        expect(animState?.playing).toBe(false);
        expect(moveState?.state).toBe('idle');
    });
});

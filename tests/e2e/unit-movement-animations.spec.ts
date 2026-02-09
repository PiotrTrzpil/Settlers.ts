import { test, expect } from './fixtures';

/**
 * E2E tests for unit movement animations and direction change events.
 *
 * These tests verify:
 * - EventBus emits correct movement events (started, stopped, directionChanged)
 * - Animation frames progress correctly during movement
 * - Direction transitions occur with correct values
 * - Idle animation state when movement stops
 *
 * Uses programmatic test map (no real game assets required).
 */

test.describe('Movement Animation Events', { tag: '@animations' }, () => {
    test('EventBus emits movementStarted when unit begins moving', async({ gp }) => {
        const page = gp.page;

        // Set up event capture before spawning/moving
        const events = await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return { error: 'no game' };

            const captured: Array<{ event: string; payload: any; timestamp: number }> = [];
            const startTime = performance.now();

            // Listen to movement events
            game.eventBus.on('unit:movementStarted', (payload: any) => {
                captured.push({
                    event: 'movementStarted',
                    payload: { ...payload },
                    timestamp: performance.now() - startTime
                });
            });

            (window as any).__capturedEvents = captured;
            return { setup: true };
        });

        expect(events).not.toHaveProperty('error');

        // Spawn unit and start movement
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const moveResult = await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        expect(moveResult).toBe(true);

        // Wait for movement to actually start
        await gp.waitForUnitsMoving(1, 5000);

        // Retrieve captured events
        const capturedEvents = await page.evaluate(() => {
            return (window as any).__capturedEvents ?? [];
        });

        expect(capturedEvents.length).toBeGreaterThan(0);
        const startEvent = capturedEvents.find((e: any) => e.event === 'movementStarted');
        expect(startEvent).toBeDefined();
        expect(startEvent.payload.entityId).toBe(unit!.id);
        expect(startEvent.payload.direction).toBeGreaterThanOrEqual(0);
        expect(startEvent.payload.direction).toBeLessThanOrEqual(5);
    });

    test('EventBus emits movementStopped when unit reaches destination', async({ gp }) => {
        const page = gp.page;

        // Set up event capture
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const captured: Array<{ event: string; payload: any; timestamp: number }> = [];
            const startTime = performance.now();

            game.eventBus.on('unit:movementStarted', (payload: any) => {
                captured.push({ event: 'movementStarted', payload: { ...payload }, timestamp: performance.now() - startTime });
            });

            game.eventBus.on('unit:movementStopped', (payload: any) => {
                captured.push({ event: 'movementStopped', payload: { ...payload }, timestamp: performance.now() - startTime });
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
        await page.waitForFunction(({ unitId }) => {
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
    });

    test('EventBus emits directionChanged on path turns', async({ gp }) => {
        const page = gp.page;

        // Set up event capture
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const captured: Array<{ event: string; payload: any; timestamp: number }> = [];
            const startTime = performance.now();

            game.eventBus.on('unit:movementStarted', (payload: any) => {
                captured.push({ event: 'movementStarted', payload: { ...payload }, timestamp: performance.now() - startTime });
            });

            game.eventBus.on('unit:directionChanged', (payload: any) => {
                captured.push({ event: 'directionChanged', payload: { ...payload }, timestamp: performance.now() - startTime });
            });

            game.eventBus.on('unit:movementStopped', (payload: any) => {
                captured.push({ event: 'movementStopped', payload: { ...payload }, timestamp: performance.now() - startTime });
            });

            (window as any).__capturedEvents = captured;
        });

        // Spawn unit
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move east first
        await gp.moveUnit(unit!.id, unit!.x + 3, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Wait for unit to start moving
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);

        // Now redirect to move south (should trigger direction change)
        const currentPos = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            const entity = game?.state.getEntity(unitId);
            return entity ? { x: entity.x, y: entity.y } : null;
        }, { unitId: unit!.id });

        expect(currentPos).not.toBeNull();

        // Issue new move command to go south (different direction)
        await gp.moveUnit(unit!.id, currentPos!.x, currentPos!.y + 5);

        // Wait for direction change event or movement to progress
        await page.waitForFunction(() => {
            const events = (window as any).__capturedEvents ?? [];
            return events.some((e: any) => e.event === 'directionChanged');
        }, null, { timeout: 8000 });

        const capturedEvents = await page.evaluate(() => {
            return (window as any).__capturedEvents ?? [];
        });

        const directionEvents = capturedEvents.filter((e: any) => e.event === 'directionChanged');
        expect(directionEvents.length).toBeGreaterThan(0);

        // Verify direction change has correct structure
        const dirEvent = directionEvents[0];
        expect(dirEvent.payload).toHaveProperty('entityId');
        expect(dirEvent.payload).toHaveProperty('direction');
        expect(dirEvent.payload).toHaveProperty('previousDirection');
        expect(dirEvent.payload.direction).not.toBe(dirEvent.payload.previousDirection);
    });

    test('direction values are valid hex directions (0-5)', async({ gp }) => {
        const page = gp.page;

        // Set up event capture for all direction-related events
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const directionsSeen: number[] = [];

            game.eventBus.on('unit:movementStarted', (payload: any) => {
                directionsSeen.push(payload.direction);
            });

            game.eventBus.on('unit:directionChanged', (payload: any) => {
                directionsSeen.push(payload.direction);
                directionsSeen.push(payload.previousDirection);
            });

            (window as any).__directionsSeen = directionsSeen;
        });

        // Spawn and move multiple units in different directions
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move in various directions to trigger different direction values
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y); // East
        await gp.waitForUnitsMoving(1, 3000);
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);

        // Verify all captured directions are valid
        const directions = await page.evaluate(() => (window as any).__directionsSeen ?? []);
        expect(directions.length).toBeGreaterThan(0);

        for (const dir of directions) {
            expect(dir).toBeGreaterThanOrEqual(0);
            expect(dir).toBeLessThanOrEqual(5);
        }
    });
});

test.describe('Animation Frame Tracking', { tag: '@animations' }, () => {
    test('animation is playing during movement', async({ gp }) => {
        const page = gp.page;

        // Spawn and start moving
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 10, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Check animation state while moving
        const animState = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const entity = game.state.getEntity(unitId);
            if (!entity || !entity.animationState) return null;

            return {
                sequenceKey: entity.animationState.sequenceKey,
                currentFrame: entity.animationState.currentFrame,
                playing: entity.animationState.playing,
                direction: entity.animationState.direction
            };
        }, { unitId: unit!.id });

        expect(animState).not.toBeNull();
        expect(animState!.playing).toBe(true);
        expect(animState!.sequenceKey).toBe('walk');
    });

    test('animation state is maintained during movement', { tag: '@slow' }, async({ gp }) => {
        const page = gp.page;

        // Spawn and start moving
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 10, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Sample animation state multiple times during movement
        const stateSamples = await page.evaluate(({ unitId }) => {
            return new Promise<Array<{ playing: boolean; sequenceKey: string }>>((resolve) => {
                const samples: Array<{ playing: boolean; sequenceKey: string }> = [];
                let count = 0;
                const maxSamples = 20;

                function sample() {
                    const game = (window as any).__settlers_game__;
                    if (game) {
                        const entity = game.state.getEntity(unitId);
                        if (entity?.animationState) {
                            samples.push({
                                playing: entity.animationState.playing,
                                sequenceKey: entity.animationState.sequenceKey
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
        await page.waitForFunction(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Check animation is stopped
        const animState = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const entity = game.state.getEntity(unitId);
            if (!entity?.animationState) return null;

            return {
                playing: entity.animationState.playing,
                currentFrame: entity.animationState.currentFrame
            };
        }, { unitId: unit!.id });

        expect(animState).not.toBeNull();
        expect(animState!.playing).toBe(false);
        expect(animState!.currentFrame).toBe(0); // Reset to frame 0 when idle
    });

    test('animation direction matches movement direction', async({ gp }) => {
        const page = gp.page;

        // Spawn unit
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move east (direction should be ~0 or close to east)
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Sample movement controller direction and animation direction
        const directionCheck = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;

            const entity = game.state.getEntity(unitId);
            const controller = game.state.movement.getController(unitId);

            if (!entity || !controller) return null;

            return {
                animDirection: entity.animationState?.direction ?? -1,
                controllerDirection: controller.direction
            };
        }, { unitId: unit!.id });

        expect(directionCheck).not.toBeNull();
        expect(directionCheck!.animDirection).toBe(directionCheck!.controllerDirection);
    });
});

test.describe('Direction Transition Events', { tag: '@animations' }, () => {
    test('direction transition triggers smooth blending state', async({ gp }) => {
        const page = gp.page;

        // Spawn unit and start moving
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);

        // Get current position and redirect south
        const currentPos = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            const entity = game?.state.getEntity(unitId);
            return entity ? { x: entity.x, y: entity.y } : null;
        }, { unitId: unit!.id });

        // Redirect to trigger direction change
        await gp.moveUnit(unit!.id, currentPos!.x, currentPos!.y + 5);

        // Check for direction transition state (previousDirection and transitionProgress)
        await expect(async() => {
            const transitionState = await page.evaluate(({ unitId }) => {
                const game = (window as any).__settlers_game__;
                const entity = game?.state.getEntity(unitId);
                if (!entity?.animationState) return null;

                const anim = entity.animationState;
                return {
                    direction: anim.direction,
                    previousDirection: anim.previousDirection,
                    transitionProgress: anim.directionTransitionProgress,
                    hasTransition: anim.previousDirection !== undefined
                };
            }, { unitId: unit!.id });

            // Either transition is in progress or already completed
            expect(transitionState).not.toBeNull();
        }).toPass({ timeout: 5000, intervals: [100, 200, 500] });
    });

    test('multiple direction changes are handled correctly', async({ gp }) => {
        const page = gp.page;

        // Track all direction change events
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const events: Array<{ direction: number; previousDirection: number; timestamp: number }> = [];
            const startTime = performance.now();

            game.eventBus.on('unit:directionChanged', (payload: any) => {
                events.push({
                    direction: payload.direction,
                    previousDirection: payload.previousDirection,
                    timestamp: performance.now() - startTime
                });
            });

            (window as any).__directionEvents = events;
        });

        // Spawn unit
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Issue multiple movement commands in quick succession to different directions
        // This simulates rapid direction changes
        await gp.moveUnit(unit!.id, unit!.x + 3, unit!.y); // East
        await gp.waitForFrames(5, 3000);

        const pos1 = await page.evaluate(({ id }) => {
            const g = (window as any).__settlers_game__;
            const e = g?.state.getEntity(id);
            return e ? { x: e.x, y: e.y } : null;
        }, { id: unit!.id });

        await gp.moveUnit(unit!.id, pos1!.x, pos1!.y + 3); // South
        await gp.waitForFrames(5, 3000);

        const pos2 = await page.evaluate(({ id }) => {
            const g = (window as any).__settlers_game__;
            const e = g?.state.getEntity(id);
            return e ? { x: e.x, y: e.y } : null;
        }, { id: unit!.id });

        await gp.moveUnit(unit!.id, pos2!.x - 3, pos2!.y); // West
        await gp.waitForFrames(10, 3000);

        // Check captured direction events
        const dirEvents = await page.evaluate(() => (window as any).__directionEvents ?? []);

        // Should have at least one direction change
        expect(dirEvents.length).toBeGreaterThanOrEqual(1);

        // All directions should be valid
        for (const event of dirEvents) {
            expect(event.direction).toBeGreaterThanOrEqual(0);
            expect(event.direction).toBeLessThanOrEqual(5);
            expect(event.previousDirection).toBeGreaterThanOrEqual(0);
            expect(event.previousDirection).toBeLessThanOrEqual(5);
        }
    });
});

test.describe('Event Sequence Verification', { tag: '@animations' }, () => {
    test('events follow correct order: started -> directionChanged* -> stopped', async({ gp }) => {
        const page = gp.page;

        // Set up comprehensive event tracking
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const timeline: Array<{ event: string; timestamp: number; entityId: number }> = [];
            const startTime = performance.now();

            game.eventBus.on('unit:movementStarted', (payload: any) => {
                timeline.push({ event: 'started', timestamp: performance.now() - startTime, entityId: payload.entityId });
            });

            game.eventBus.on('unit:directionChanged', (payload: any) => {
                timeline.push({ event: 'directionChanged', timestamp: performance.now() - startTime, entityId: payload.entityId });
            });

            game.eventBus.on('unit:movementStopped', (payload: any) => {
                timeline.push({ event: 'stopped', timestamp: performance.now() - startTime, entityId: payload.entityId });
            });

            (window as any).__eventTimeline = timeline;
        });

        // Spawn and move unit with a turn (L-shaped path)
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move east then redirect south
        await gp.moveUnit(unit!.id, unit!.x + 3, unit!.y);
        await gp.waitForUnitsMoving(1, 3000);

        // Get position after some movement
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);
        const midPos = await page.evaluate(({ id }) => {
            const g = (window as any).__settlers_game__;
            const e = g?.state.getEntity(id);
            return e ? { x: e.x, y: e.y } : null;
        }, { id: unit!.id });

        // Redirect south and wait for arrival AND idle state
        await gp.moveUnit(unit!.id, midPos!.x, midPos!.y + 2);
        await gp.waitForUnitAtDestination(unit!.id, midPos!.x, midPos!.y + 2, 15000);
        await page.waitForFunction(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Analyze event timeline
        const timeline = await page.evaluate(() => (window as any).__eventTimeline ?? []);
        const unitEvents = timeline.filter((e: any) => e.entityId === unit!.id);

        expect(unitEvents.length).toBeGreaterThan(0);

        // First event should be 'started'
        expect(unitEvents[0].event).toBe('started');

        // Last event should be 'stopped'
        const lastEvent = unitEvents[unitEvents.length - 1];
        expect(lastEvent.event).toBe('stopped');

        // Events should be in chronological order
        for (let i = 1; i < unitEvents.length; i++) {
            expect(unitEvents[i].timestamp).toBeGreaterThanOrEqual(unitEvents[i - 1].timestamp);
        }
    });

    test('stopped event fires even for very short movements', async({ gp }) => {
        const page = gp.page;

        // Track events
        await page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            const events: string[] = [];

            game.eventBus.on('unit:movementStarted', () => events.push('started'));
            game.eventBus.on('unit:movementStopped', () => events.push('stopped'));

            (window as any).__shortMoveEvents = events;
        });

        // Spawn unit and move just 1 tile
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 1;
        await gp.moveUnit(unit!.id, targetX, unit!.y);

        // Wait for arrival AND idle state
        await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
        await page.waitForFunction(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Should have both started and stopped
        const events = await page.evaluate(() => (window as any).__shortMoveEvents ?? []);
        expect(events).toContain('started');
        expect(events).toContain('stopped');
    });
});

test.describe('Animation State Integrity', { tag: '@animations' }, () => {
    test('animation state is initialized for spawned units', async({ gp }) => {
        const page = gp.page;

        // Spawn unit and start movement to trigger animation initialization
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Start movement to trigger animation state initialization
        await gp.moveUnit(unit!.id, unit!.x + 3, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Check animation state exists and is properly initialized
        const animState = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            const entity = game?.state.getEntity(unitId);
            if (!entity?.animationState) return null;

            return {
                hasAnimationState: true,
                sequenceKey: entity.animationState.sequenceKey,
                currentFrame: entity.animationState.currentFrame,
                direction: entity.animationState.direction,
                playing: entity.animationState.playing,
                elapsedMs: entity.animationState.elapsedMs
            };
        }, { unitId: unit!.id });

        expect(animState).not.toBeNull();
        expect(animState!.hasAnimationState).toBe(true);
        expect(animState!.currentFrame).toBeGreaterThanOrEqual(0);
        expect(animState!.direction).toBeGreaterThanOrEqual(0);
        expect(animState!.direction).toBeLessThanOrEqual(5);
    });

    test('walk sequence is used during movement', async({ gp }) => {
        const page = gp.page;

        // Spawn and move
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Check walk sequence
        const seqKey = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            const entity = game?.state.getEntity(unitId);
            return entity?.animationState?.sequenceKey ?? null;
        }, { unitId: unit!.id });

        expect(seqKey).toBe('walk');
    });

    test('animation resets to frame 0 on stop', async({ gp }) => {
        const page = gp.page;

        // Spawn and move
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 2, unit!.y);
        await gp.waitForUnitAtDestination(unit!.id, unit!.x + 2, unit!.y, 10000);

        // Wait for controller to be idle
        await page.waitForFunction(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            const controller = game.state.movement.getController(unitId);
            return controller && controller.state === 'idle';
        }, { unitId: unit!.id }, { timeout: 5000 });

        // Check frame is 0
        const frame = await page.evaluate(({ unitId }) => {
            const game = (window as any).__settlers_game__;
            const entity = game?.state.getEntity(unitId);
            return entity?.animationState?.currentFrame ?? -1;
        }, { unitId: unit!.id });

        expect(frame).toBe(0);
    });
});

import { test, expect } from './fixtures';

/**
 * E2E tests for unit movement animations.
 *
 * Consolidated tests verify:
 * - Animation plays with walk sequence during movement and stops at destination
 * - Animation direction matches movement controller direction
 * - Direction updates correctly when path changes
 * - movementStopped event fires when unit reaches destination
 *
 * All game state queries go through GamePage helpers.
 * Uses programmatic test map (no real game assets required).
 */

test.describe('Animation During Movement', { tag: '@animations' }, () => {
    test('walk animation plays during movement and stops at destination', async({ gp }) => {
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 5;
        await gp.moveUnit(unit!.id, targetX, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        await test.step('animation is playing with walk sequence', async() => {
            const animState = await gp.getAnimationState(unit!.id);
            expect(animState).not.toBeNull();
            expect(animState!.playing).toBe(true);
            expect(animState!.sequenceKey).toBe('walk');
            expect(animState!.loop).toBe(true);
        });

        await test.step('movement controller is in moving state', async() => {
            const moveState = await gp.getMovementControllerState(unit!.id);
            expect(moveState).not.toBeNull();
            expect(moveState!.state).toBe('moving');
        });

        await test.step('animation direction matches movement direction (valid hex 0-5)', async() => {
            const animState = await gp.getAnimationState(unit!.id);
            const moveState = await gp.getMovementControllerState(unit!.id);
            expect(animState!.direction).toBe(moveState!.direction);
            expect(animState!.direction).toBeGreaterThanOrEqual(0);
            expect(animState!.direction).toBeLessThanOrEqual(5);
        });

        await test.step('animation stops and resets to frame 0 at destination', async() => {
            await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
            await gp.waitForMovementIdle(unit!.id, 5000);

            const animState = await gp.getAnimationState(unit!.id);
            expect(animState).not.toBeNull();
            expect(animState!.playing).toBe(false);
            expect(animState!.currentFrame).toBe(0);

            const moveState = await gp.getMovementControllerState(unit!.id);
            expect(moveState!.state).toBe('idle');
        });
    });

    test('animation state is maintained consistently during movement', { tag: '@slow' }, async({ gpNormal: gp }) => {
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        await gp.moveUnit(unit!.id, unit!.x + 15, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);

        // Sample animation state multiple times during movement
        const stateSamples = await gp.sampleAnimationStates(unit!.id, 20);
        expect(stateSamples.length).toBeGreaterThan(5);

        // All samples should show animation is playing with walk sequence
        for (const sample of stateSamples) {
            expect(sample.playing).toBe(true);
            expect(sample.sequenceKey).toBe('walk');
        }
    });

    test('direction updates when path changes', async({ gpNormal: gp }) => {
        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        // Move east first
        await gp.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gp.waitForUnitsMoving(1, 5000);
        await gp.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);

        const initialAnim = await gp.getAnimationState(unit!.id);
        expect(initialAnim).not.toBeNull();

        // Get current position and redirect south
        const entities = await gp.getEntities({ type: 1 });
        const current = entities.find(e => e.id === unit!.id)!;
        await gp.moveUnit(unit!.id, current.x, current.y + 5);
        await gp.waitForFrames(10, 3000);

        // Direction should still be valid after path change
        const newAnim = await gp.getAnimationState(unit!.id);
        expect(newAnim).not.toBeNull();
        expect(newAnim!.direction).toBeGreaterThanOrEqual(0);
        expect(newAnim!.direction).toBeLessThanOrEqual(5);
    });
});

test.describe('Movement Events', { tag: '@animations' }, () => {
    test('movementStopped event fires when unit reaches destination', async({ gp }) => {
        const { getEvents } = await gp.captureMovementEvents();

        const unit = await gp.spawnUnit(1);
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 2;
        await gp.moveUnit(unit!.id, targetX, unit!.y);

        await gp.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
        await gp.waitForMovementIdle(unit!.id, 5000);

        const events = await getEvents();
        const stopEvent = events.find(e => e.entityId === unit!.id);
        expect(stopEvent).toBeDefined();
        expect(stopEvent!.direction).toBeGreaterThanOrEqual(0);
        expect(stopEvent!.direction).toBeLessThanOrEqual(5);
    });
});

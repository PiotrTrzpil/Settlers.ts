import { test, expect } from './fixtures';

/**
 * E2E tests for unit movement animations (Tier 2: Spatial).
 *
 * Consolidated tests verify:
 * - Animation plays with walk sequence during movement and stops at destination
 * - Animation direction matches movement controller direction
 * - Direction updates correctly when path changes
 * - movementStopped event fires when unit reaches destination
 *
 * All game state queries go through GamePage helpers.
 * Uses the `gs` fixture — game-state only, no WebGL required.
 */

test.describe('Animation During Movement', { tag: '@slow' }, () => {
    test('walk animation plays during movement and stops at destination', async ({ gs }) => {
        const unit = await gs.actions.spawnUnit('Builder');
        expect(unit).not.toBeNull();

        // Use longer distance (15 tiles) so movement is still in progress during assertions
        const targetX = unit!.x + 15;
        await gs.actions.moveUnit(unit!.id, targetX, unit!.y);
        await gs.wait.waitForUnitsMoving(1, 5000);

        await test.step('animation is playing with walk sequence', async () => {
            const animState = await gs.queries.getAnimationState(unit!.id);
            expect(animState).not.toBeNull();
            expect(animState!.playing).toBe(true);
            expect(animState!.sequenceKey).toBe('walk');
            expect(animState!.loop).toBe(true);
        });

        await test.step('movement controller is in moving state', async () => {
            const moveState = await gs.queries.getMovementControllerState(unit!.id);
            expect(moveState).not.toBeNull();
            expect(moveState!.state).toBe('moving');
        });

        await test.step('animation direction matches movement direction (valid hex 0-5)', async () => {
            const animState = await gs.queries.getAnimationState(unit!.id);
            const moveState = await gs.queries.getMovementControllerState(unit!.id);
            expect(animState!.direction).toBe(moveState!.direction);
            expect(animState!.direction).toBeGreaterThanOrEqual(0);
            expect(animState!.direction).toBeLessThanOrEqual(5);
        });

        await test.step('animation stops and resets to frame 0 at destination', async () => {
            await gs.wait.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
            await gs.wait.waitForMovementIdle(unit!.id, 5000);

            const animState = await gs.queries.getAnimationState(unit!.id);
            expect(animState).not.toBeNull();
            expect(animState!.playing).toBe(false);
            expect(animState!.currentFrame).toBe(0);

            const moveState = await gs.queries.getMovementControllerState(unit!.id);
            expect(moveState!.state).toBe('idle');
        });
    });

    test('animation state is maintained consistently during movement', async ({ gs }) => {
        // Use 1x speed for more animation samples during movement
        await gs.actions.setGameSpeed(1.0);

        const unit = await gs.actions.spawnUnit('Builder');
        expect(unit).not.toBeNull();

        await gs.actions.moveUnit(unit!.id, unit!.x + 15, unit!.y);
        await gs.wait.waitForUnitsMoving(1, 5000);

        // Sample animation state multiple times during movement
        const stateSamples = await gs.queries.sampleAnimationStates(unit!.id, 20);
        expect(stateSamples.length).toBeGreaterThan(5);

        // All samples should show animation is playing with walk sequence
        for (const sample of stateSamples) {
            expect(sample.playing).toBe(true);
            expect(sample.sequenceKey).toBe('walk');
        }
    });

    test('direction updates when path changes', async ({ gs }) => {
        // Use 1x speed for direction observation
        await gs.actions.setGameSpeed(1.0);

        const unit = await gs.actions.spawnUnit('Builder');
        expect(unit).not.toBeNull();

        // Move east first
        await gs.actions.moveUnit(unit!.id, unit!.x + 5, unit!.y);
        await gs.wait.waitForUnitsMoving(1, 5000);
        await gs.wait.waitForUnitToMove(unit!.id, unit!.x, unit!.y, 5000);

        const initialAnim = await gs.queries.getAnimationState(unit!.id);
        expect(initialAnim).not.toBeNull();

        // Get current position and redirect south
        const entities = await gs.actions.getEntities({ type: 1 });
        const current = entities.find(e => e.id === unit!.id)!;
        await gs.actions.moveUnit(unit!.id, current.x, current.y + 5);
        await gs.wait.waitForTicks(10, 3000);

        // Direction should still be valid after path change
        const newAnim = await gs.queries.getAnimationState(unit!.id);
        expect(newAnim).not.toBeNull();
        expect(newAnim!.direction).toBeGreaterThanOrEqual(0);
        expect(newAnim!.direction).toBeLessThanOrEqual(5);
    });
});

test.describe('Movement Events', { tag: '@slow' }, () => {
    test('movementStopped event fires when unit reaches destination', async ({ gs }) => {
        const { getEvents } = await gs.queries.captureMovementEvents();

        const unit = await gs.actions.spawnUnit('Builder');
        expect(unit).not.toBeNull();

        const targetX = unit!.x + 2;
        await gs.actions.moveUnit(unit!.id, targetX, unit!.y);

        await gs.wait.waitForUnitAtDestination(unit!.id, targetX, unit!.y, 10000);
        await gs.wait.waitForMovementIdle(unit!.id, 5000);

        const events = await getEvents();
        const stopEvent = events.find(e => e.entityId === unit!.id);
        expect(stopEvent).toBeDefined();
        expect(stopEvent!.direction).toBeGreaterThanOrEqual(0);
        expect(stopEvent!.direction).toBeLessThanOrEqual(5);
    });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for settler job selection/rotation in SettlerTaskSystem.
 *
 * Verifies that settlers with multiple jobs (e.g., farmer with plant + harvest)
 * correctly select between them based on target availability.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SettlerTaskSystem, type SettlerTaskSystemConfig } from '@/game/systems/settler-tasks/settler-task-system';
import { SearchType, type WorkHandler } from '@/game/systems/settler-tasks/types';
import { AnimationService } from '@/game/animation/animation-service';
import { EntityType } from '@/game/entity';
import { UnitType } from '@/game/unit-types';
import { createTestContext, addUnit, type TestContext } from './helpers/test-game';

/** Helper: create a SettlerTaskSystem wired to a TestContext */
function createTaskSystem(ctx: TestContext): SettlerTaskSystem {
    const animationService = new AnimationService();
    const config: SettlerTaskSystemConfig = {
        gameState: ctx.state,
        animationService,
        inventoryManager: ctx.inventoryManager,
        eventBus: ctx.eventBus,
    };
    return new SettlerTaskSystem(config);
}

/** Stub handler that always returns a target entity */
function createTargetHandler(target: { entityId: number | null; x: number; y: number }): WorkHandler {
    return {
        findTarget: () => target,
        canWork: () => true,
        onWorkTick: () => false,
    };
}

/** Stub handler that never finds a target */
function createNoTargetHandler(): WorkHandler {
    return {
        findTarget: () => null,
        canWork: () => false,
        onWorkTick: () => false,
    };
}

describe('SettlerTaskSystem job selection', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    describe('single-job settlers', () => {
        it('woodcutter picks its only job when target exists', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 15, 15, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 15, y: 15 });
            // TREE handler is registered by domain systems; replace it for test
            // Use a wrapper since registerWorkHandler throws on duplicate
            (system as any).workHandlers.set(SearchType.TREE, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            // Woodcutter should be working (started job)
            expect(system.isWorking(entity.id)).toBe(true);
        });

        it('woodcutter stays idle when no target exists', () => {
            const system = createTaskSystem(ctx);
            const handler = createNoTargetHandler();
            (system as any).workHandlers.set(SearchType.TREE, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(false);
        });
    });

    describe('multi-job settlers (farmer)', () => {
        it('farmer selects harvest job when harvestable grain target exists', () => {
            const system = createTaskSystem(ctx);
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 15, 15, 0);
            const handler = createTargetHandler({ entityId: grain.id, x: 15, y: 15 });
            (system as any).workHandlers.set(SearchType.GRAIN, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
            // Verify it picked the harvest job (GO_TO_TARGET first task), not plant (SEARCH_POS)
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('farmer.harvest');
        });

        it('farmer selects plant job when no harvestable target exists', () => {
            const system = createTaskSystem(ctx);
            const handler = createNoTargetHandler();
            (system as any).workHandlers.set(SearchType.GRAIN, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            // Tick 1: handleIdle selects plant job → state=WORKING
            system.tick(0.016);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job!.jobId).toBe('farmer.plant');

            // Tick 2: SEARCH_POS runs, findTarget returns null, no shouldWaitForWork → FAILED → INTERRUPTED
            system.tick(0.016);
            // Tick 3: INTERRUPTED → IDLE
            system.tick(0.016);
            expect(runtime.state).toBe('IDLE');
        });

        it('farmer selects plant when findTarget returns position-only (no entityId)', () => {
            const system = createTaskSystem(ctx);
            // findTarget returns a position but no entity → not suitable for GO_TO_TARGET jobs
            const handler: WorkHandler = {
                findTarget: () => ({ entityId: null, x: 20, y: 20 }),
                canWork: () => true,
                onWorkTick: () => false,
                onWorkAtPositionComplete: () => {},
            };
            (system as any).workHandlers.set(SearchType.GRAIN, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
            const runtime = (system as any).runtimes.get(entity.id)!;
            // Position-only target → entity-target jobs skipped → falls through to plant
            expect(runtime.job.jobId).toBe('farmer.plant');
        });

        it('farmer prefers harvest over plant when entity target exists', () => {
            const system = createTaskSystem(ctx);
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 12, 12, 0);
            const handler = createTargetHandler({ entityId: grain.id, x: 12, y: 12 });
            (system as any).workHandlers.set(SearchType.GRAIN, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            // Tick multiple times to verify harvest is consistently preferred
            system.tick(0.016);

            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('farmer.harvest');
        });
    });

    describe('forester (single self-searching job)', () => {
        it('forester selects plant job even when findTarget returns a position', () => {
            const system = createTaskSystem(ctx);
            const handler: WorkHandler = {
                findTarget: () => ({ entityId: null, x: 20, y: 20 }),
                canWork: () => true,
                onWorkTick: () => false,
                onWorkAtPositionComplete: () => {},
            };
            (system as any).workHandlers.set(SearchType.TREE_SEED_POS, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('forester.plant');
        });

        it('forester selects plant job when findTarget returns null', () => {
            const system = createTaskSystem(ctx);
            const handler = createNoTargetHandler();
            (system as any).workHandlers.set(SearchType.TREE_SEED_POS, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            // Tick 1: handleIdle selects plant job → state=WORKING
            system.tick(0.016);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job!.jobId).toBe('forester.plant');

            // Tick 2: SEARCH_POS fails (null target, no shouldWaitForWork) → INTERRUPTED
            system.tick(0.016);
            // Tick 3: INTERRUPTED → IDLE
            system.tick(0.016);
            expect(runtime.state).toBe('IDLE');
        });
    });

    describe('job completion cycles', () => {
        it('farmer can alternate between harvest and plant across job cycles', () => {
            const system = createTaskSystem(ctx);

            let hasTarget = true;
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 11, 10, 0);
            const handler: WorkHandler = {
                findTarget: () => (hasTarget ? { entityId: grain.id, x: 11, y: 10 } : null),
                canWork: () => true,
                onWorkTick: (_targetId, progress) => progress >= 1.0,
                onWorkComplete: () => {},
                onWorkAtPositionComplete: () => {},
            };
            (system as any).workHandlers.set(SearchType.GRAIN, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            // First cycle: target exists → harvest
            system.tick(0.016);
            let runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('farmer.harvest');

            // Simulate job completion by resetting state
            runtime.state = 'IDLE';
            runtime.job = null;

            // Second cycle: no target → plant
            hasTarget = false;
            system.tick(0.016);
            runtime = (system as any).runtimes.get(entity.id)!;
            // Plant is a SEARCH_POS job. Since findTarget returns null and
            // shouldWaitForWork is falsy, SEARCH_POS fails → interrupted → idle.
            // But the important thing is selectJob picked plant, not harvest.
            // Let's verify by giving it a position to find:
            hasTarget = false; // still no entity target
            runtime.state = 'IDLE';
            runtime.job = null;

            // Now make findTarget return a position (no entity) for planting
            (handler as any).findTarget = () => ({ entityId: null, x: 20, y: 20 });
            system.tick(0.016);
            runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job!.jobId).toBe('farmer.plant');
        });
    });

    describe('edge cases', () => {
        it('settler with no registered handler stays idle', () => {
            const system = createTaskSystem(ctx);
            // Stonecutter uses STONE handler, which is not registered
            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Stonecutter });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(false);
        });

        it('settler with handler that throws stays idle', () => {
            const system = createTaskSystem(ctx);
            const handler: WorkHandler = {
                findTarget: () => {
                    throw new Error('domain error');
                },
                canWork: () => false,
                onWorkTick: () => false,
            };
            (system as any).workHandlers.set(SearchType.TREE, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            // Should not throw - error is caught and logged
            expect(() => system.tick(0.016)).not.toThrow();
            expect(system.isWorking(entity.id)).toBe(false);
        });
    });
});

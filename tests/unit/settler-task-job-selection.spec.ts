/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for settler job selection/rotation in SettlerTaskSystem.
 *
 * Verifies that settlers with multiple jobs (e.g., farmer with plant + harvest)
 * correctly select between them based on target availability.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SettlerTaskSystem, type SettlerTaskSystemConfig } from '@/game/features/settler-tasks/settler-task-system';
import { SearchType, type EntityWorkHandler, type PositionWorkHandler } from '@/game/features/settler-tasks/types';
import { EntityVisualService } from '@/game/animation/entity-visual-service';
import { EntityType } from '@/game/entity';
import { UnitType } from '@/game/unit-types';
import { createTestContext, addUnit, type TestContext } from './helpers/test-game';
import { CarrierManager } from '@/game/features/carriers';

/** Helper: create a SettlerTaskSystem wired to a TestContext */
function createTaskSystem(ctx: TestContext): SettlerTaskSystem {
    const visualService = new EntityVisualService();
    // Mirror production wiring: init visual state for all entities
    ctx.eventBus.on('entity:created', ({ entityId, variation }) => {
        visualService.init(entityId, variation);
    });
    const carrierManager = new CarrierManager({
        entityProvider: ctx.state,
        eventBus: ctx.eventBus,
    });
    const config: SettlerTaskSystemConfig = {
        gameState: ctx.state,
        visualService,
        inventoryManager: ctx.inventoryManager,
        eventBus: ctx.eventBus,
        carrierManager,
        getInventoryVisualizer: () => null as any,
    };
    return new SettlerTaskSystem(config);
}

/** Stub entity handler that always returns a target entity */
function createTargetHandler(target: { entityId: number; x: number; y: number }): EntityWorkHandler {
    return {
        type: 'entity',
        findTarget: () => target,
        canWork: () => true,
        onWorkTick: () => false,
    };
}

/** Stub entity handler that never finds a target */
function createNoTargetHandler(): EntityWorkHandler {
    return {
        type: 'entity',
        findTarget: () => null,
        canWork: () => false,
        onWorkTick: () => false,
    };
}

/** Stub position handler */
function createPositionHandler(position: { x: number; y: number } | null): PositionWorkHandler {
    return {
        type: 'position',
        findPosition: () => position,
        onWorkAtPositionComplete: () => {},
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
            (system as any).handlerRegistry.entityHandlers.set(SearchType.TREE, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
        });

        it('woodcutter stays idle when no target exists', () => {
            const system = createTaskSystem(ctx);
            (system as any).handlerRegistry.entityHandlers.set(SearchType.TREE, createNoTargetHandler());

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(false);
        });
    });

    describe('multi-job settlers (farmer)', () => {
        it('farmer selects harvest job when harvestable grain target exists', () => {
            const system = createTaskSystem(ctx);
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 15, 15, 0);
            (system as any).handlerRegistry.entityHandlers.set(
                SearchType.GRAIN,
                createTargetHandler({ entityId: grain.id, x: 15, y: 15 })
            );

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('farmer.harvest');
        });

        it('farmer selects plant job when no harvestable target exists', () => {
            const system = createTaskSystem(ctx);
            (system as any).handlerRegistry.entityHandlers.set(SearchType.GRAIN, createNoTargetHandler());
            (system as any).handlerRegistry.positionHandlers.set(SearchType.GRAIN, createPositionHandler(null));

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            // Tick 1: handleIdle selects plant job → state=WORKING
            system.tick(0.016);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job!.jobId).toBe('farmer.plant');

            // Tick 2: SEARCH_POS runs, findPosition returns null, no shouldWaitForWork → FAILED → INTERRUPTED
            system.tick(0.016);
            // Tick 3: INTERRUPTED → IDLE
            system.tick(0.016);
            expect(runtime.state).toBe('IDLE');
        });

        it('farmer selects plant when entity handler returns no target', () => {
            const system = createTaskSystem(ctx);
            (system as any).handlerRegistry.entityHandlers.set(SearchType.GRAIN, createNoTargetHandler());
            (system as any).handlerRegistry.positionHandlers.set(
                SearchType.GRAIN,
                createPositionHandler({ x: 20, y: 20 })
            );

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('farmer.plant');
        });

        it('farmer prefers harvest over plant when entity target exists', () => {
            const system = createTaskSystem(ctx);
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 12, 12, 0);
            (system as any).handlerRegistry.entityHandlers.set(
                SearchType.GRAIN,
                createTargetHandler({ entityId: grain.id, x: 12, y: 12 })
            );
            (system as any).handlerRegistry.positionHandlers.set(
                SearchType.GRAIN,
                createPositionHandler({ x: 20, y: 20 })
            );

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('farmer.harvest');
        });
    });

    describe('forester (single self-searching job)', () => {
        it('forester selects plant job when position handler returns a position', () => {
            const system = createTaskSystem(ctx);
            (system as any).handlerRegistry.positionHandlers.set(
                SearchType.TREE_SEED_POS,
                createPositionHandler({ x: 20, y: 20 })
            );

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            system.tick(0.016);

            expect(system.isWorking(entity.id)).toBe(true);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job.jobId).toBe('forester.plant');
        });

        it('forester selects plant job when findPosition returns null', () => {
            const system = createTaskSystem(ctx);
            (system as any).handlerRegistry.positionHandlers.set(SearchType.TREE_SEED_POS, createPositionHandler(null));

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            // Tick 1: handleIdle selects plant job → state=WORKING
            system.tick(0.016);
            const runtime = (system as any).runtimes.get(entity.id)!;
            expect(runtime.job!.jobId).toBe('forester.plant');

            // Tick 2: SEARCH_POS fails (null position, no shouldWaitForWork) → INTERRUPTED
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
            const entityHandler: EntityWorkHandler = {
                type: 'entity',
                findTarget: () => (hasTarget ? { entityId: grain.id, x: 11, y: 10 } : null),
                canWork: () => true,
                onWorkTick: (_targetId, progress) => progress >= 1.0,
                onWorkComplete: () => {},
            };
            (system as any).handlerRegistry.entityHandlers.set(SearchType.GRAIN, entityHandler);
            (system as any).handlerRegistry.positionHandlers.set(
                SearchType.GRAIN,
                createPositionHandler({ x: 20, y: 20 })
            );

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
            const handler: EntityWorkHandler = {
                type: 'entity',
                findTarget: () => {
                    throw new Error('domain error');
                },
                canWork: () => false,
                onWorkTick: () => false,
            };
            (system as any).handlerRegistry.entityHandlers.set(SearchType.TREE, handler);

            const { entity } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            // Should not throw - error is caught and logged
            expect(() => system.tick(0.016)).not.toThrow();
            expect(system.isWorking(entity.id)).toBe(false);
        });
    });
});

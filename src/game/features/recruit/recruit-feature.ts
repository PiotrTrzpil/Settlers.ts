/**
 * Recruit Feature — wires the RecruitSystem, UnitTransformer and RecruitSegments into the feature
 * registry, registers the TRANSFORM_* choreography executors with their node hooks (irreversible,
 * onAbort releases the carrier's source reservation, onRestore re-reserves it) and the `Recruit`
 * JobKind handler (player-queued / direct transforms).
 *
 * Commands: recruit_specialist (enqueue recruitment, or dequeue/dismiss for negative counts).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { SettlerTaskExports } from '../settler-tasks';
import type { InventoryExports } from '../inventory';
import type { TerritoryExports } from '../territory';
import { ChoreoTaskType } from '../../systems/choreo';
import { RecruitSystem } from './recruit-system';
import { UnitTransformer } from './unit-transformer';
import { ToolSourceResolver } from './tool-source-resolver';
import {
    createTransformRecruitExecutor,
    createTransformRecruitBuildingExecutor,
    createTransformDirectExecutor,
} from './recruit-choreo-executors';
import { TickPhase } from '../../core/tick-phase';
import type { RecruitSpecialistCommand } from '../../commands/command-types';
import { executeRecruitSpecialist } from './recruit-commands';
import { RecruitSegmentsImpl, type RecruitSegments } from './recruit-segments';
import { createRecruitJobKind } from './recruit-job-kind';

export interface RecruitExports {
    recruitSystem: RecruitSystem;
    unitTransformer: UnitTransformer;
    toolSourceResolver: ToolSourceResolver;
    /** Recruit prefix builder + source reservation for owned jobs (Workplace / Construction / Barracks). */
    recruitSegments: RecruitSegments;
}

export const RecruitFeature: FeatureDefinition = {
    id: 'recruit',
    dependencies: ['carriers', 'settler-tasks', 'inventory', 'territory'],

    create(ctx: FeatureContext) {
        const { carrierRegistry, idleCarrierPool } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { jobRunner, jobs } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

        const toolSourceResolver = new ToolSourceResolver(ctx.gameState, inventoryManager);

        const unitTransformer = new UnitTransformer({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
            toolSourceResolver,
            unitReservation: ctx.unitReservation,
        });
        const recruitSegments = new RecruitSegmentsImpl(ctx.gameState, unitTransformer);
        jobs.registerKind(createRecruitJobKind(recruitSegments));

        const recruitSystem = new RecruitSystem({
            gameState: ctx.gameState,
            idleCarrierPool,
            unitTransformer,
            toolSourceResolver,
            segments: recruitSegments,
            jobs,
            assignJob: (unitId, job, moveTo) => jobRunner.assignJob(unitId, job, moveTo),
            territoryCheck: (a, b, player) => territoryManager.areConnected(a, b, player),
        });

        // Register recruit-specific choreography executors on the kernel ChoreoSystem.
        // These depend on inventory + eventBus, which are feature-layer concerns.
        const transformHooks = recruitSegments.createTransformHooks();
        ctx.choreoSystem.register(
            ChoreoTaskType.TRANSFORM_RECRUIT,
            createTransformRecruitExecutor(ctx.gameState, ctx.eventBus, inventoryManager),
            transformHooks
        );
        ctx.choreoSystem.register(
            ChoreoTaskType.TRANSFORM_RECRUIT_BUILDING,
            createTransformRecruitBuildingExecutor(ctx.eventBus, toolSourceResolver),
            transformHooks
        );
        ctx.choreoSystem.register(
            ChoreoTaskType.TRANSFORM_DIRECT,
            createTransformDirectExecutor(ctx.eventBus),
            transformHooks
        );

        unitTransformer.registerEvents();
        recruitSystem.registerEvents();

        return {
            systems: [recruitSystem],
            tickPhase: TickPhase.Recruitment,
            persistence: [],
            exports: { recruitSystem, unitTransformer, toolSourceResolver, recruitSegments } satisfies RecruitExports,
            commands: {
                recruit_specialist: cmd =>
                    executeRecruitSpecialist({ recruitSystem, unitTransformer }, cmd as RecruitSpecialistCommand),
            },
            destroy: () => {
                unitTransformer.unregisterEvents();
                recruitSystem.unregisterEvents();
            },
        };
    },
};

/**
 * Recruit Feature — wires the RecruitSystem and UnitTransformer into the feature registry,
 * and registers TRANSFORM_RECRUIT / TRANSFORM_DIRECT choreography executors on the shared ChoreoSystem.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { SettlerTaskExports } from '../settler-tasks';
import type { InventoryExports } from '../inventory';
import { ChoreoTaskType } from '../../systems/choreo';
import { RecruitSystem } from '../../systems/recruit/recruit-system';
import { UnitTransformer } from '../../systems/recruit/unit-transformer';
import { ToolSourceResolver } from '../../systems/recruit/tool-source-resolver';
import { createTransformRecruitExecutor, createTransformDirectExecutor } from './recruit-choreo-executors';

export interface RecruitExports {
    recruitSystem: RecruitSystem;
    unitTransformer: UnitTransformer;
}

export const RecruitFeature: FeatureDefinition = {
    id: 'recruit',
    dependencies: ['carriers', 'settler-tasks', 'inventory'],

    create(ctx: FeatureContext) {
        const { carrierRegistry, idleCarrierPool } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { settlerTaskSystem, choreoSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');

        const toolSourceResolver = new ToolSourceResolver(ctx.gameState);

        const unitTransformer = new UnitTransformer({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
            toolSourceResolver,
            assignJob: (unitId, job, moveTo) => settlerTaskSystem.assignJob(unitId, job, moveTo),
            unitReservation: ctx.unitReservation,
        });

        const recruitSystem = new RecruitSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            idleCarrierPool,
            unitTransformer,
            toolSourceResolver,
            assignJob: (unitId, job, moveTo) => settlerTaskSystem.assignJob(unitId, job, moveTo),
        });

        // Register recruit-specific choreography executors on the shared ChoreoSystem.
        // These depend on inventory + eventBus, which are feature-layer concerns.
        choreoSystem.register(
            ChoreoTaskType.TRANSFORM_RECRUIT,
            createTransformRecruitExecutor(ctx.gameState, ctx.eventBus, inventoryManager)
        );
        choreoSystem.register(ChoreoTaskType.TRANSFORM_DIRECT, createTransformDirectExecutor(ctx.eventBus));

        unitTransformer.registerEvents();
        recruitSystem.registerEvents();

        return {
            systems: [recruitSystem],
            persistence: [],
            exports: { recruitSystem, unitTransformer } satisfies RecruitExports,
            destroy: () => {
                unitTransformer.unregisterEvents();
                recruitSystem.unregisterEvents();
            },
        };
    },
};

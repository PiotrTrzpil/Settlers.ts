/**
 * Auto-Recruit Feature — self-registering feature that converts idle carriers
 * into specialist workers (builders, diggers) when construction sites need them.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { CarrierFeatureExports } from '../carriers';
import type { ConstructionSiteManager } from '../building-construction';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { LogisticsDispatcher } from '../logistics';
import { ToolSourceResolver } from './tool-source-resolver';
import { UnitTransformer } from './unit-transformer';
import { AutoRecruitSystem } from './auto-recruit-system';

export interface AutoRecruitExports {
    autoRecruitSystem: AutoRecruitSystem;
}

export const AutoRecruitFeature: FeatureDefinition = {
    id: 'auto-recruit',
    dependencies: ['carriers', 'building-construction', 'settler-tasks', 'logistics-dispatcher'],

    create(ctx: FeatureContext) {
        const { carrierRegistry } = ctx.getFeature<CarrierFeatureExports>('carriers');
        const { constructionSiteManager } = ctx.getFeature<{
            constructionSiteManager: ConstructionSiteManager;
        }>('building-construction');
        const { settlerTaskSystem } = ctx.getFeature<{ settlerTaskSystem: SettlerTaskSystem }>('settler-tasks');
        const { logisticsDispatcher } = ctx.getFeature<{
            logisticsDispatcher: LogisticsDispatcher;
        }>('logistics-dispatcher');

        const toolSourceResolver = new ToolSourceResolver(ctx.gameState);
        const unitTransformer = new UnitTransformer({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
        });

        const autoRecruitSystem = new AutoRecruitSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            carrierRegistry,
            getSettlerTaskSystem: () => settlerTaskSystem,
            constructionSiteManager,
            toolSourceResolver,
            unitTransformer,
            isCarrierBusy: (id: number) => logisticsDispatcher.activeJobs.has(id),
        });

        autoRecruitSystem.registerEvents();

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            autoRecruitSystem.cancelRecruitment(entityId);
        });

        return {
            systems: [autoRecruitSystem],
            exports: { autoRecruitSystem } satisfies AutoRecruitExports,
            destroy: () => autoRecruitSystem.unregisterEvents(),
        };
    },
};

/**
 * AI Player Feature — feature module wiring for the AI player system.
 *
 * Registers AiPlayerSystemImpl as a TickSystem in the 'AI' group.
 * Depends on combat, territory, victory-conditions, inventory, and
 * building-construction so the AI can query soldier states, territory
 * borders, game-over status, material counts, and construction sites.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { VictoryConditionsExports } from '../victory-conditions';
import type { BuildingConstructionExports } from '../building-construction';
import type { TerritoryExports } from '../territory';
import { createTerritoryPlacementFilter } from '../territory';
import type { AiPlayerExports } from './types';
import { AiPlayerSystemImpl } from './internal/ai-player-system';

export const AiPlayerFeature: FeatureDefinition = {
    id: 'ai-player',
    dependencies: ['combat', 'territory', 'victory-conditions', 'inventory', 'building-construction'],

    create(ctx: FeatureContext) {
        const victoryExports = ctx.getFeature<VictoryConditionsExports>('victory-conditions');
        const constructionExports = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const territoryExports = ctx.getFeature<TerritoryExports>('territory');

        const aiSystem = new AiPlayerSystemImpl({
            gameState: ctx.gameState,
            executeCommand: ctx.executeCommand,
            isGameOver: () => victoryExports.victorySystem.getResult().ended,
        });
        aiSystem.setHasSite(id => constructionExports.constructionSiteManager.hasSite(id));
        aiSystem.setPlacementFilter(() => {
            const tm = territoryExports.territoryManager;
            return tm ? createTerritoryPlacementFilter(tm) : null;
        });

        const exports: AiPlayerExports = { aiSystem };

        return {
            systems: [aiSystem],
            systemGroup: 'AI',
            exports,
            persistence: 'none',
            onTerrainReady(terrain) {
                aiSystem.onTerrainReady(terrain);
            },
        };
    },
};

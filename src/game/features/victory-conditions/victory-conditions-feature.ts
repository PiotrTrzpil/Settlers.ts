/**
 * Victory Conditions Feature — checks win/loss conditions each tick.
 *
 * Default: castle-based elimination (Settlers 4 engine default).
 * A player loses when all their castles are destroyed.
 * The human player wins when all enemies are eliminated.
 */

import type { FeatureDefinition, FeatureContext, FeatureDiagnostics } from '../feature';
import type { BuildingConstructionExports } from '../building-construction/building-construction-feature';
import { VictoryConditionsSystem } from './victory-conditions-system';
import type { GameResult } from './victory-conditions-system';
import { EntityType } from '../../entity';
import { BuildingType } from '../../buildings/building-type';

export interface VictoryConditionsExports {
    victorySystem: VictoryConditionsSystem;
}

export const VictoryConditionsFeature: FeatureDefinition = {
    id: 'victory-conditions',
    dependencies: ['building-construction'],

    create(ctx: FeatureContext) {
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const victorySystem = new VictoryConditionsSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            localPlayer: 0, // overridden by game.ts after map load
        });

        // Track castle counts via events instead of per-tick scanning
        ctx.on('building:completed', ({ buildingType, ...rest }) => {
            // building:completed has no 'player' directly — look up entity
            const entity = ctx.gameState.getEntity(rest.buildingId);
            if (entity) {
                victorySystem.onBuildingCompleted(buildingType, entity.player);
            }
        });

        ctx.on('building:removed', ({ buildingId, buildingType }) => {
            const entity = ctx.gameState.getEntity(buildingId);
            if (entity) {
                victorySystem.onBuildingRemoved(buildingType, entity.player);
            }
        });

        ctx.on('building:ownerChanged', ({ buildingType, oldPlayer, newPlayer }) => {
            victorySystem.onBuildingOwnerChanged(buildingType, oldPlayer, newPlayer);
        });

        const exports: VictoryConditionsExports = { victorySystem };

        return {
            systems: [victorySystem],
            systemGroup: 'Victory',
            exports,
            persistence: 'none',
            onRestoreComplete() {
                victorySystem.reset();
                for (const e of ctx.gameState.entities) {
                    if (e.type !== EntityType.Building) {
                        continue;
                    }
                    if (constructionSiteManager.hasSite(e.id)) {
                        continue;
                    }
                    victorySystem.onBuildingCompleted(e.subType as BuildingType, e.player);
                }
            },
            diagnostics: (): FeatureDiagnostics => {
                const result: GameResult = victorySystem.getResult();
                const active = victorySystem.getActivePlayers();
                return {
                    label: 'Victory Conditions',
                    sections: [
                        {
                            label: 'Status',
                            entries: [
                                { key: 'Game ended', value: result.ended },
                                { key: 'Winner', value: result.winner ?? 'none' },
                                { key: 'Reason', value: result.reason ?? 'n/a' },
                                { key: 'Active players', value: active.length },
                                { key: 'Active', value: active.join(', ') || 'none' },
                            ],
                        },
                    ],
                };
            },
        };
    },
};

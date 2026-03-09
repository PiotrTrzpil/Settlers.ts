/**
 * Victory Conditions Feature — checks win/loss conditions each tick.
 *
 * Default: castle-based elimination (Settlers 4 engine default).
 * A player loses when all their castles are destroyed.
 * The human player wins when all enemies are eliminated.
 */

import type { FeatureDefinition, FeatureContext, FeatureDiagnostics } from '../feature';
import { VictoryConditionsSystem } from './victory-conditions-system';
import type { GameResult } from './victory-conditions-system';

export interface VictoryConditionsExports {
    victorySystem: VictoryConditionsSystem;
}

export const VictoryConditionsFeature: FeatureDefinition = {
    id: 'victory-conditions',

    create(ctx: FeatureContext) {
        const victorySystem = new VictoryConditionsSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            localPlayer: 0, // overridden by game.ts after map load
        });

        // Track castle counts via events instead of per-tick scanning
        ctx.on('building:completed', ({ buildingType, ...rest }) => {
            // building:completed has no 'player' directly — look up entity
            const entity = ctx.gameState.getEntity(rest.entityId);
            if (entity) victorySystem.onBuildingCompleted(buildingType, entity.player);
        });

        ctx.on('building:removed', ({ entityId, buildingType }) => {
            const entity = ctx.gameState.getEntity(entityId);
            if (entity) victorySystem.onBuildingRemoved(buildingType, entity.player);
        });

        ctx.on('building:ownerChanged', ({ buildingType, oldPlayer, newPlayer }) => {
            victorySystem.onBuildingOwnerChanged(buildingType, oldPlayer, newPlayer);
        });

        const exports: VictoryConditionsExports = { victorySystem };

        return {
            systems: [victorySystem],
            systemGroup: 'Victory',
            exports,
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

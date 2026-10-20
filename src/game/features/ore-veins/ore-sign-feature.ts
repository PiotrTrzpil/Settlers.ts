/**
 * Ore Sign Feature — FeatureDefinition wiring for resource sign lifecycle
 * and the geologist work handler.
 *
 * This feature manages:
 * - Placement of resource sign entities on prospected tiles (via `ResourceSignSystem`)
 * - Automatic expiry of signs after `SIGN_LIFETIME` seconds
 * - Cleanup of sign tracking state on external entity removal
 * - Geologist work handler (prospects tiles from `OreVeinData`)
 *
 * Public API (via exports):
 * - `signSystem: ResourceSignSystem` — place signs
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { ResourceSignSystem } from './resource-sign-system';
import type { OreVeinExports } from './ore-vein-feature';
import type { SettlerTaskExports } from '../settler-tasks';
import { SearchType } from '../settler-tasks';
import { createGeologistHandler } from './work-handlers';

/** Exports provided by OreSignFeature. */
export interface OreSignExports {
    signSystem: ResourceSignSystem;
}

export const OreSignFeature: FeatureDefinition = {
    id: 'ore-signs',
    dependencies: ['settler-tasks', 'ore-veins'],

    create(ctx: FeatureContext) {
        const { oreVeinData } = ctx.getFeature<OreVeinExports>('ore-veins');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const signSystem = new ResourceSignSystem({
            executeCommand: ctx.executeCommand,
            getGroundEntityAt: tile => ctx.gameState.getGroundEntityAt(tile),
            oreVeinData,
        });

        ctx.cleanupRegistry.onEntityRemoved(signSystem.onEntityRemoved.bind(signSystem));

        settlerTaskSystem.registerWorkHandler(
            SearchType.RESOURCE_POS,
            createGeologistHandler(oreVeinData, ctx.terrain, signSystem)
        );

        const exports: OreSignExports = { signSystem };

        return {
            systems: [signSystem],
            exports,
            persistence: 'none',
        };
    },
};

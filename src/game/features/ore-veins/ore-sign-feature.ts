/**
 * Ore Sign Feature — FeatureDefinition wiring for resource sign lifecycle.
 *
 * This feature manages:
 * - Placement of resource sign entities on prospected tiles (via `ResourceSignSystem`)
 * - Automatic expiry of signs after `SIGN_LIFETIME` seconds
 * - Cleanup of sign tracking state on external entity removal
 *
 * Public API (via exports):
 * - `signSystem: ResourceSignSystem` — place signs and inject ore vein data
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { ResourceSignSystem } from './resource-sign-system';

/**
 * Exports provided by OreSignFeature.
 * Consumers (e.g. geologist work handler) call `signSystem.placeSign(x, y)`.
 */
export interface OreSignExports {
    signSystem: ResourceSignSystem;
}

/**
 * Ore sign feature definition.
 * No feature dependencies — uses only core services from context.
 */
export const OreSignFeature: FeatureDefinition = {
    id: 'ore-signs',

    create(ctx: FeatureContext) {
        const signSystem = new ResourceSignSystem(ctx.gameState);

        // Clean up sign tracking state when entities are removed externally
        // (e.g. the game engine removes a sign that was already handled elsewhere).
        ctx.cleanupRegistry.onEntityRemoved(id => signSystem.onEntityRemoved(id));

        return {
            systems: [signSystem],
            exports: { signSystem } satisfies OreSignExports,
        };
    },
};

/**
 * Ore Sign Feature — FeatureDefinition wiring for resource sign lifecycle
 * and ore vein data.
 *
 * This feature manages:
 * - Per-tile ore vein data on mountain terrain (created in onTerrainReady)
 * - Placement of resource sign entities on prospected tiles (via `ResourceSignSystem`)
 * - Automatic expiry of signs after `SIGN_LIFETIME` seconds
 * - Cleanup of sign tracking state on external entity removal
 *
 * Public API (via exports):
 * - `signSystem: ResourceSignSystem` — place signs and inject ore vein data
 * - `oreVeinData: OreVeinData | null` — per-tile ore data (available after terrain)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { TerrainData } from '../../terrain';
import { ResourceSignSystem } from './resource-sign-system';
import { OreVeinData } from './ore-vein-data';
import { OreVeinPersistence } from './ore-vein-persistence';
import { populateOreVeins, loadOreVeinsFromResourceData } from './populate-ore-veins';
import type { SettlerTaskExports } from '../settler-tasks/settler-tasks-feature';
import { SearchType } from '../settler-tasks';
import { createGeologistHandler } from './work-handlers';

/**
 * Exports provided by OreSignFeature.
 * `oreVeinData` is null until onTerrainReady is called.
 */
export interface OreSignExports {
    signSystem: ResourceSignSystem;
    oreVeinData: OreVeinData | null;
}

export const OreSignFeature: FeatureDefinition = {
    id: 'ore-signs',
    dependencies: ['settler-tasks'],

    create(ctx: FeatureContext) {
        const signSystem = new ResourceSignSystem({
            executeCommand: ctx.executeCommand,
            getGroundEntityAt: (x, y) => ctx.gameState.getGroundEntityAt(x, y),
        });

        ctx.cleanupRegistry.onEntityRemoved(signSystem.onEntityRemoved.bind(signSystem));

        const oreVeinPersistence = new OreVeinPersistence();
        const exports: OreSignExports = { signSystem, oreVeinData: null };

        return {
            systems: [signSystem],
            exports,
            persistence: [oreVeinPersistence],
            onTerrainReady(terrain: TerrainData, resourceData?: Uint8Array) {
                const oreVeinData = new OreVeinData(terrain.width, terrain.height);
                if (resourceData) {
                    loadOreVeinsFromResourceData(oreVeinData, resourceData);
                } else {
                    populateOreVeins(oreVeinData, terrain);
                }
                exports.oreVeinData = oreVeinData;
                signSystem.setOreVeinData(oreVeinData);
                oreVeinPersistence.setOreVeinData(oreVeinData);

                // Register geologist handler + inject ore vein data into settler-tasks
                const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
                settlerTaskSystem.setOreVeinData(oreVeinData);
                settlerTaskSystem.registerWorkHandler(
                    SearchType.RESOURCE_POS,
                    createGeologistHandler(oreVeinData, terrain, signSystem)
                );
            },
        };
    },
};

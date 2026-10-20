/**
 * Ore Vein Feature — owns per-tile ore vein data on mountain terrain.
 *
 * Ore data is loaded from the map's resource layer when present,
 * otherwise generated procedurally from terrain. Consumed by mines
 * (settler-tasks workplace handler) and geologists (ore-signs).
 *
 * Public API (via exports):
 * - `oreVeinData: OreVeinData` — per-tile ore type, level, prospected state
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { OreVeinData } from './ore-vein-data';
import { OreVeinPersistence } from './ore-vein-persistence';
import { populateOreVeins, loadOreVeinsFromResourceData } from './populate-ore-veins';

export interface OreVeinExports {
    oreVeinData: OreVeinData;
}

export const OreVeinFeature: FeatureDefinition = {
    id: 'ore-veins',
    dependencies: [],

    create(ctx: FeatureContext) {
        const oreVeinData = new OreVeinData(ctx.terrain.width, ctx.terrain.height);
        if (ctx.resourceData) {
            loadOreVeinsFromResourceData(oreVeinData, ctx.resourceData);
        } else {
            populateOreVeins(oreVeinData, ctx.terrain);
        }

        return {
            exports: { oreVeinData } satisfies OreVeinExports,
            persistence: [new OreVeinPersistence(oreVeinData)],
        };
    },
};

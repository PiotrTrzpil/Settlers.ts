/**
 * Building Overlay Feature - Self-registering feature module for building overlay management.
 *
 * Manages layered sprite overlays on buildings:
 * - Creates overlay instances when buildings complete construction
 * - Removes overlay instances on entity removal
 * - Exposes BuildingOverlayManager and OverlayRegistry for renderer and settler tasks
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { BuildingOverlayManager } from './building-overlay-manager';
import { OverlayRegistry } from './overlay-registry';
import { populateOverlayRegistry } from './overlay-data-loader';

/**
 * Exports provided by BuildingOverlayFeature.
 */
export interface BuildingOverlayFeatureExports {
    buildingOverlayManager: BuildingOverlayManager;
    overlayRegistry: OverlayRegistry;
}

export const BuildingOverlayFeature: FeatureDefinition = {
    id: 'building-overlays',
    dependencies: [],

    create(ctx: FeatureContext) {
        const overlayRegistry = new OverlayRegistry();
        populateOverlayRegistry(overlayRegistry);

        const buildingOverlayManager = new BuildingOverlayManager({
            overlayRegistry,
            entityProvider: ctx.gameState,
        });

        ctx.on('building:completed', ({ entityId, buildingType }) => {
            const entity = ctx.gameState.getEntity(entityId);
            if (!entity) return;
            buildingOverlayManager.addBuilding(entityId, buildingType, entity.race);
        });

        ctx.cleanupRegistry.onEntityRemoved(buildingOverlayManager.removeBuilding.bind(buildingOverlayManager));

        return {
            systems: [buildingOverlayManager],
            exports: { buildingOverlayManager, overlayRegistry } satisfies BuildingOverlayFeatureExports,
            persistence: 'none',
        };
    },
};

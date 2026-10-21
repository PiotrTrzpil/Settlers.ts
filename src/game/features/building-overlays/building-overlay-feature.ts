/**
 * Building Overlay Feature - Self-registering feature module for building overlay management.
 *
 * Manages layered sprite overlays on buildings:
 * - Creates overlay instances when buildings complete construction
 * - Removes overlay instances on entity removal
 * - Exposes BuildingOverlayManager and OverlayRegistry for the renderer, and the
 *   choreography TriggerSystem for settler work executors
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { BuildingOverlayManager } from './building-overlay-manager';
import { OverlayRegistry } from './overlay-registry';
import { populateOverlayRegistry } from './overlay-data-loader';
import { TriggerSystemImpl, type TriggerSystem } from './trigger-system';
import { getGameDataLoader } from '@/resources/game-data';
import { TickPhase } from '../../core/tick-phase';

/**
 * Exports provided by BuildingOverlayFeature.
 */
export interface BuildingOverlayFeatureExports {
    buildingOverlayManager: BuildingOverlayManager;
    overlayRegistry: OverlayRegistry;
    /** Fires/stops overlay animations from choreography node triggers (used by work executors). */
    triggerSystem: TriggerSystem;
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

        const triggerSystem = new TriggerSystemImpl({
            setWorkingOverlay: (buildingId, working) => buildingOverlayManager.setWorking(buildingId, working),
            gameState: ctx.gameState,
            dataLoader: getGameDataLoader(),
        });

        ctx.on('building:completed', ({ buildingId, buildingType }) => {
            const entity = ctx.gameState.getEntityOrThrow(buildingId, 'building completed for overlay setup');
            buildingOverlayManager.addBuilding(buildingId, buildingType, entity.race);
        });

        ctx.cleanupRegistry.onEntityRemoved(buildingOverlayManager.removeBuilding.bind(buildingOverlayManager));

        return {
            systems: [buildingOverlayManager],
            tickPhase: TickPhase.BuildingOverlays,
            exports: { buildingOverlayManager, overlayRegistry, triggerSystem } satisfies BuildingOverlayFeatureExports,
            persistence: 'none',
        };
    },
};

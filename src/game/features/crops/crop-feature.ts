/**
 * Crop Feature - Self-registering feature module for crop lifecycle.
 *
 * This feature manages:
 * - Crop growth (planted by farmers → full grown)
 * - Crop harvesting (by farmers/beekeepers)
 * - Harvested stub decay and removal
 *
 * Wraps CropSystem and handles event subscriptions.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { CropSystem } from './crop-system';
import { EntityType } from '../../entity';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';

export interface CropFeatureExports {
    cropSystem: CropSystem;
}

export const CropFeature: FeatureDefinition = {
    id: 'crops',
    dependencies: [],

    create(ctx: FeatureContext) {
        const cropSystem = new CropSystem({
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            eventBus: ctx.eventBus,
            executeCommand: ctx.executeCommand,
        });

        // Register crop entities on creation (map-loaded crops start as Mature)
        ctx.on('entity:created', ({ entityId, type, subType }) => {
            if (
                type === EntityType.MapObject &&
                OBJECT_TYPE_CATEGORY[subType as MapObjectType] === MapObjectCategory.Crops
            ) {
                cropSystem.register(entityId, subType as MapObjectType);
            }
        });

        // Clean up crop state on entity removal
        ctx.cleanupRegistry.onEntityRemoved(cropSystem.unregister.bind(cropSystem));

        return {
            systems: [cropSystem],
            exports: { cropSystem } satisfies CropFeatureExports,
        };
    },
};

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
import { CropSystem, CropStage } from './crop-system';
import { EntityType } from '../../entity';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import type { PlantCropCommand } from '../../commands/command-types';
import { executePlantCrop } from '../../commands/handlers/system-handlers';

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

        const cropDeps = { state: ctx.gameState, eventBus: ctx.eventBus, cropSystem };

        return {
            systems: [cropSystem],
            exports: { cropSystem } satisfies CropFeatureExports,
            persistence: [cropSystem],
            commands: {
                plant_crop: cmd => executePlantCrop(cropDeps, cmd as PlantCropCommand),
            },
            diagnostics: () => {
                const counts = countCropStages(cropSystem);
                return {
                    label: 'Crops',
                    sections: [
                        {
                            label: 'Status',
                            entries: [
                                { key: 'Total', value: counts.total },
                                { key: 'Growing', value: counts.growing },
                                { key: 'Mature', value: counts.mature },
                                { key: 'Harvesting', value: counts.harvesting },
                                { key: 'Harvested', value: counts.harvested },
                            ],
                        },
                    ],
                };
            },
        };
    },
};

function countCropStages(system: CropSystem) {
    let total = 0,
        growing = 0,
        mature = 0,
        harvesting = 0,
        harvested = 0;
    for (const [, state] of system.getAllCropStates()) {
        total++;
        switch (state.stage) {
        case CropStage.Growing:
            growing++;
            break;
        case CropStage.Mature:
            mature++;
            break;
        case CropStage.Harvesting:
            harvesting++;
            break;
        case CropStage.Harvested:
            harvested++;
            break;
        }
    }
    return { total, growing, mature, harvesting, harvested };
}

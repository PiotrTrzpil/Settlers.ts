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
import type { SettlerTaskExports } from '../settler-tasks/settler-tasks-feature';
import { SearchType } from '../settler-tasks';
import { createCropHarvestHandler } from './work-handlers';
import { createPlantingHandler } from '../trees/work-handlers';

export interface CropFeatureExports {
    cropSystem: CropSystem;
}

export const CropFeature: FeatureDefinition = {
    id: 'crops',
    dependencies: ['settler-tasks'],

    create(ctx: FeatureContext) {
        const cropSystem = new CropSystem({
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            eventBus: ctx.eventBus,
            executeCommand: ctx.executeCommand,
        });

        // Register crop work handlers (harvest + planting for each crop type)
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const cropHandlerConfigs = [
            { search: SearchType.GRAIN, plantSearch: SearchType.GRAIN_SEED_POS, crop: MapObjectType.Grain },
            { search: SearchType.SUNFLOWER, plantSearch: SearchType.SUNFLOWER_SEED_POS, crop: MapObjectType.Sunflower },
            { search: SearchType.AGAVE, plantSearch: SearchType.AGAVE_SEED_POS, crop: MapObjectType.Agave },
            { search: SearchType.BEEHIVE, plantSearch: SearchType.BEEHIVE_SEED_POS, crop: MapObjectType.Beehive },
            { search: SearchType.VINE, plantSearch: SearchType.VINE_SEED_POS, crop: MapObjectType.Grape },
        ] as const;

        for (const { search, plantSearch, crop } of cropHandlerConfigs) {
            settlerTaskSystem.registerWorkHandler(search, createCropHarvestHandler(ctx.gameState, cropSystem, crop));
            settlerTaskSystem.registerWorkHandler(plantSearch, createPlantingHandler(cropSystem.getCropPlanter(crop)));
        }

        // Register crop entities on creation (map-loaded crops start as Mature)
        ctx.on('entity:created', ({ entityId, entityType: type, subType }) => {
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
            persistence: [cropSystem.persistentStore],
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

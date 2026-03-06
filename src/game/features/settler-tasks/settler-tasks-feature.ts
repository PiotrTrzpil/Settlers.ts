/**
 * SettlerTask Feature -- wraps SettlerTaskSystem and all work handlers
 * as a self-registering feature.
 *
 * Work handlers that need terrain (water, geologist) are registered
 * in onTerrainReady. All others are registered during create().
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { BuildingOverlayFeatureExports } from '../building-overlays';
import type { BuildingConstructionExports } from '../building-construction/building-construction-feature';
import type { WorkAreaExports } from '../work-areas/work-areas-feature';
import type { ProductionControlExports } from '../production-control/production-control-feature';
import type { MaterialTransferExports } from '../material-transfer/material-transfer-feature';
import type { TreeFeatureExports } from '../trees';
import type { StoneFeatureExports } from '../stones';
import type { CropFeatureExports } from '../crops';
import type { OreSignExports } from '../ore-veins';
import type { OreVeinData } from '../ore-veins/ore-vein-data';
import type { BuildingPileRegistry } from '../inventory';
import type { TerrainData } from '../../terrain';
import type { BarracksTrainingManager } from '../barracks';
import { SettlerTaskSystem, SearchType } from './index';
import { MapObjectType } from '../../types/map-object-types';
import {
    createWoodcuttingHandler,
    createStonecuttingHandler,
    createForesterHandler,
    createCropHarvestHandler,
    createPlantingHandler,
    createWaterHandler,
    createGeologistHandler,
    createDiggerHandler,
    createBuilderHandler,
} from './work-handlers';

export interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
    /** Allows BarracksFeature to inject its training manager after loading. */
    setBarracksTrainingManager: (getter: () => BarracksTrainingManager) => void;
    /** Inject BuildingPileRegistry once game data is loaded. */
    setPileRegistry: (registry: BuildingPileRegistry) => void;
}

export const SettlerTaskFeature: FeatureDefinition = {
    id: 'settler-tasks',
    dependencies: [
        'inventory',
        'building-overlays',
        'building-construction',
        'work-areas',
        'production-control',
        'material-transfer',
        'trees',
        'stones',
        'crops',
        'ore-signs',
    ],

    create(ctx: FeatureContext) {
        const { inventoryManager, pileRegistry: pileSlotRegistry } = ctx.getFeature<InventoryExports>('inventory');
        const { buildingOverlayManager } = ctx.getFeature<BuildingOverlayFeatureExports>('building-overlays');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { workAreaStore } = ctx.getFeature<WorkAreaExports>('work-areas');
        const { productionControlManager } = ctx.getFeature<ProductionControlExports>('production-control');
        const { materialTransfer } = ctx.getFeature<MaterialTransferExports>('material-transfer');
        const { treeSystem } = ctx.getFeature<TreeFeatureExports>('trees');
        const { stoneSystem } = ctx.getFeature<StoneFeatureExports>('stones');
        const { cropSystem } = ctx.getFeature<CropFeatureExports>('crops');
        const { signSystem } = ctx.getFeature<OreSignExports>('ore-signs');

        // BuildingPileRegistry (XML pile positions) -- conditionally set later when game data loads.
        // The lazy getter in SettlerTaskSystem tolerates null until then.
        let pileRegistry: BuildingPileRegistry | null = null;

        // Barracks training manager is wired lazily by BarracksFeature after it loads.
        // The closure reads the mutable variable at call time, not at construction time.
        let barracksTrainingManagerGetter: (() => BarracksTrainingManager) | undefined;

        const settlerTaskSystem = new SettlerTaskSystem({
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            inventoryManager,
            eventBus: ctx.eventBus,
            getPileSlotRegistry: () => pileSlotRegistry,
            getPileRegistry: () => pileRegistry,
            workAreaStore,
            buildingOverlayManager,
            getProductionControlManager: () => productionControlManager,
            getBarracksTrainingManager: (() => barracksTrainingManagerGetter?.()) as () => BarracksTrainingManager,
            constructionSiteManager,
            executeCommand: ctx.executeCommand,
            materialTransfer,
        });

        // --- Non-terrain work handlers ---

        settlerTaskSystem.registerWorkHandler(
            SearchType.CONSTRUCTION_DIG,
            createDiggerHandler(ctx.gameState, constructionSiteManager)
        );
        settlerTaskSystem.registerWorkHandler(
            SearchType.CONSTRUCTION,
            createBuilderHandler(ctx.gameState, constructionSiteManager)
        );
        settlerTaskSystem.registerWorkHandler(SearchType.TREE, createWoodcuttingHandler(ctx.gameState, treeSystem));
        settlerTaskSystem.registerWorkHandler(SearchType.STONE, createStonecuttingHandler(ctx.gameState, stoneSystem));
        settlerTaskSystem.registerWorkHandler(SearchType.TREE_SEED_POS, createForesterHandler(treeSystem));

        // Crop handlers -- harvest + planting for each crop type
        const cropHandlerConfigs = [
            { search: SearchType.GRAIN, plantSearch: SearchType.GRAIN_SEED_POS, crop: MapObjectType.Grain },
            { search: SearchType.SUNFLOWER, plantSearch: SearchType.SUNFLOWER_SEED_POS, crop: MapObjectType.Sunflower },
            { search: SearchType.AGAVE, plantSearch: SearchType.AGAVE_SEED_POS, crop: MapObjectType.Agave },
            { search: SearchType.BEEHIVE, plantSearch: SearchType.BEEHIVE_SEED_POS, crop: MapObjectType.Beehive },
        ] as const;

        for (const { search, plantSearch, crop } of cropHandlerConfigs) {
            settlerTaskSystem.registerWorkHandler(search, createCropHarvestHandler(ctx.gameState, cropSystem, crop));
            settlerTaskSystem.registerWorkHandler(plantSearch, createPlantingHandler(cropSystem.getCropPlanter(crop)));
        }

        const exports: SettlerTaskExports = {
            settlerTaskSystem,
            setBarracksTrainingManager: (getter: () => BarracksTrainingManager) => {
                barracksTrainingManagerGetter = getter;
            },
            setPileRegistry: (registry: BuildingPileRegistry) => {
                pileRegistry = registry;
            },
        };

        return {
            systems: [settlerTaskSystem],
            systemGroup: 'Units',
            exports,
            onTerrainReady(terrain: TerrainData) {
                // Water handler -- needs terrain to find river tiles
                settlerTaskSystem.registerWorkHandler(
                    SearchType.WATER,
                    createWaterHandler(
                        terrain,
                        inventoryManager,
                        settlerTaskSystem.getAssignedBuilding.bind(settlerTaskSystem)
                    )
                );

                // Geologist handler -- needs terrain + ore vein data
                const oreSignExports = ctx.getFeature<OreSignExports & { oreVeinData: OreVeinData }>('ore-signs');
                settlerTaskSystem.setOreVeinData(oreSignExports.oreVeinData);
                settlerTaskSystem.registerWorkHandler(
                    SearchType.RESOURCE_POS,
                    createGeologistHandler(oreSignExports.oreVeinData, terrain, signSystem)
                );
            },
        };
    },
};

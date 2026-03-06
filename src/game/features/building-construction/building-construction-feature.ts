/**
 * BuildingConstruction Feature — consolidates all construction systems into
 * a single self-registering feature.
 *
 * Wraps:
 * - ConstructionSiteManager (construction site state)
 * - BuildingConstructionSystem (terrain modification, phase transitions)
 * - ResidenceSpawnerSystem (carrier spawning from residences)
 * - ConstructionRequestSystem (material delivery requests for construction)
 * - BuildingLifecycleHandler (event-driven domain handlers)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { RequestManagerExports } from '../logistics';
import type { TerrainData } from '../../terrain';
import { ConstructionSiteManager } from './construction-site-manager';
import { BuildingConstructionSystem } from './construction-system';
import { ResidenceSpawnerSystem } from './residence-spawner';
import { ConstructionRequestSystem } from './construction-request-system';
import { BuildingLifecycleHandler } from './building-lifecycle-feature';

export interface BuildingConstructionExports {
    constructionSiteManager: ConstructionSiteManager;
    constructionSystem: BuildingConstructionSystem;
    residenceSpawner: ResidenceSpawnerSystem;
}

export const BuildingConstructionFeature: FeatureDefinition = {
    id: 'building-construction',
    dependencies: ['inventory', 'logistics'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { requestManager } = ctx.getFeature<RequestManagerExports>('logistics');

        const constructionSiteManager = new ConstructionSiteManager(ctx.eventBus, ctx.gameState.rng);

        const constructionSystem = new BuildingConstructionSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            executeCommand: ctx.executeCommand,
        });

        const residenceSpawner = new ResidenceSpawnerSystem({
            gameState: ctx.gameState,
            executeCommand: ctx.executeCommand,
        });
        constructionSystem.setResidenceSpawner(residenceSpawner);
        constructionSystem.registerEvents();

        const constructionRequestSystem = new ConstructionRequestSystem(constructionSiteManager, requestManager);

        // BuildingLifecycleHandler manages construction site registration,
        // inventory swaps on completion, and material delivery tracking.
        // NOTE: productionControlManager and barracksTrainingManager lifecycle
        // is now handled by their own features (ProductionControlFeature, BarracksFeature).
        const buildingLifecycle = new BuildingLifecycleHandler({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            cleanupRegistry: ctx.cleanupRegistry,
        });
        buildingLifecycle.registerEvents();

        const exports: BuildingConstructionExports = {
            constructionSiteManager,
            constructionSystem,
            residenceSpawner,
        };

        return {
            systems: [constructionSystem, residenceSpawner, constructionRequestSystem],
            systemGroup: 'Buildings',
            exports,
            onTerrainReady(terrain: TerrainData) {
                constructionSystem.setTerrainContext({
                    terrain,
                    onTerrainModified: () => ctx.eventBus.emit('terrain:modified', {}),
                });
                residenceSpawner.setTerrain(terrain);
            },
            destroy: () => buildingLifecycle.unregisterEvents(),
        };
    },
};

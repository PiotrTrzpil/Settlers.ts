/**
 * BuildingConstruction Feature — consolidates all construction systems into
 * a single self-registering feature.
 *
 * Wraps:
 * - ConstructionSiteManager (construction site state)
 * - BuildingConstructionSystem (terrain modification, phase transitions)
 * - ResidenceSpawnerSystem (carrier spawning from residences)
 * - ConstructionRequestSystem (material delivery demands for construction)
 * - BuildingLifecycleHandler (event-driven domain handlers)
 * - BuildingPileRegistry + PilePositionResolver (XML pile positions)
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import type { DemandQueueExports } from '../logistics/demand-queue-feature';
import type { TerrainData } from '../../terrain';
import { ConstructionSiteManager } from './construction-site-manager';
import { BuildingConstructionSystem } from './construction-system';
import { ResidenceSpawnerSystem } from './residence-spawner';
import { ConstructionRequestSystem } from './construction-request-system';
import { BuildingLifecycleHandler } from './building-lifecycle-feature';
import { getGameDataLoader } from '@/resources/game-data';
import { BuildingPileRegistry } from '../../systems/inventory/building-pile-registry';
import { PilePositionResolver } from '../inventory/pile-position-resolver';

export interface BuildingConstructionExports {
    constructionSiteManager: ConstructionSiteManager;
    constructionSystem: BuildingConstructionSystem;
    constructionRequestSystem: ConstructionRequestSystem;
    residenceSpawner: ResidenceSpawnerSystem;
    pileRegistry: BuildingPileRegistry | null;
}

export const BuildingConstructionFeature: FeatureDefinition = {
    id: 'building-construction',
    dependencies: ['inventory', 'logistics'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { demandQueue, jobStore } = ctx.getFeature<DemandQueueExports>('logistics');

        const constructionSiteManager = new ConstructionSiteManager(ctx.eventBus, ctx.gameState.rng, inventoryManager);

        const constructionSystem = new BuildingConstructionSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            executeCommand: ctx.executeCommand,
        });

        const residenceSpawner = new ResidenceSpawnerSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
        });
        constructionSystem.setResidenceSpawner(residenceSpawner);

        const constructionRequestSystem = new ConstructionRequestSystem(
            constructionSiteManager,
            demandQueue,
            jobStore,
            inventoryManager
        );

        // Create pile position resolver from XML game data (if loaded).
        const dataLoader = getGameDataLoader();
        let pileRegistry: BuildingPileRegistry | null = null;
        let pilePositionResolver: PilePositionResolver | undefined;
        if (dataLoader.isLoaded()) {
            pileRegistry = new BuildingPileRegistry(dataLoader.getData());
            pilePositionResolver = new PilePositionResolver(ctx.gameState, pileRegistry, constructionSiteManager);
        }

        // BuildingLifecycleHandler manages construction site registration,
        // inventory swaps on completion, and material delivery tracking.
        const buildingLifecycle = new BuildingLifecycleHandler({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            cleanupRegistry: ctx.cleanupRegistry,
            pilePositionResolver: pilePositionResolver!,
        });
        // Lifecycle must register before construction system so registerSite runs
        // before the building:placed handler that captures terrain data.
        buildingLifecycle.registerEvents();
        constructionSystem.registerEvents();

        // Configure inventory manager with pile entity management deps
        inventoryManager.configure({
            executeCommand: ctx.executeCommand,
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
        });

        const exports: BuildingConstructionExports = {
            constructionSiteManager,
            constructionSystem,
            constructionRequestSystem,
            residenceSpawner,
            pileRegistry,
        };

        return {
            systems: [constructionSystem, residenceSpawner, constructionRequestSystem],
            systemGroup: 'Buildings',
            exports,
            persistence: [constructionSiteManager, residenceSpawner],
            onTerrainReady(terrain: TerrainData) {
                constructionSystem.setTerrainContext({
                    terrain,
                    onTerrainModified: (reason, x, y) => ctx.eventBus.emit('terrain:modified', { reason, x, y }),
                });
            },
            onRestoreComplete() {
                constructionSystem.rebuildAfterRestore();
            },
            destroy: () => buildingLifecycle.unregisterEvents(),
        };
    },
};

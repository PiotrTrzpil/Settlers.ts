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
import type { DemandLedgerExports } from '../logistics/demand-ledger-feature';
import { ConstructionSiteManager } from './construction-site-manager';
import { BuildingConstructionSystem } from './construction-system';
import { ResidenceSpawnerSystem } from './residence-spawner';
import { ConstructionRequestSystem } from './construction-request-system';
import { BuildingLifecycleHandler } from './building-lifecycle-feature';
import { getGameDataLoader } from '@/resources/game-data';
import { BuildingPileRegistry, PilePositionResolver } from '../inventory';
import { TickPhase } from '../../core/tick-phase';

export interface BuildingConstructionExports {
    constructionSiteManager: ConstructionSiteManager;
    constructionSystem: BuildingConstructionSystem;
    constructionRequestSystem: ConstructionRequestSystem;
    residenceSpawner: ResidenceSpawnerSystem;
    pileRegistry: BuildingPileRegistry;
}

export const BuildingConstructionFeature: FeatureDefinition = {
    id: 'building-construction',
    dependencies: ['inventory', 'logistics'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');
        const { demandLedger } = ctx.getFeature<DemandLedgerExports>('logistics');

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
            demandLedger,
            ctx.eventBus
        );

        constructionSystem.setTerrainContext({
            terrain: ctx.terrain,
            onTerrainModified: (reason, tile) =>
                ctx.eventBus.emit('terrain:modified', { reason, x: tile.x, y: tile.y }),
        });

        // Pile positions from XML game data (always loaded before a game is created).
        const pileRegistry = new BuildingPileRegistry(getGameDataLoader().getData());
        const pilePositionResolver = new PilePositionResolver(ctx.gameState, pileRegistry, constructionSiteManager);

        // BuildingLifecycleHandler manages construction site registration,
        // inventory swaps on completion, and material delivery tracking.
        const buildingLifecycle = new BuildingLifecycleHandler({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            constructionSiteManager,
            inventoryManager,
            cleanupRegistry: ctx.cleanupRegistry,
            pilePositionResolver,
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
            tickPhase: TickPhase.Construction,
            exports,
            persistence: [constructionSiteManager.persistentStore],
            onRestoreComplete() {
                constructionSystem.rebuildAfterRestore();
            },
            destroy: () => {
                buildingLifecycle.unregisterEvents();
                constructionRequestSystem.destroy();
            },
        };
    },
};

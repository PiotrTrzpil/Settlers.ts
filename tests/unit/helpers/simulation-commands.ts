/**
 * Command handler wiring for test simulations.
 * Extracted from test-simulation.ts — mirrors GameCore.wireCommandHandlers for the headless harness.
 */

import { registerAllHandlers, type CommandHandlerRegistry } from '@/game/commands';
import type { GameState } from '@/game/game-state';
import type { GameServices } from '@/game/game-services';
import type { EventBus } from '@/game/event-bus';
import type { GameSettingsManager } from '@/game/game-settings';
import type { TerrainData } from '@/game/terrain';

export interface SimulationCommandDeps {
    state: GameState;
    services: GameServices;
    eventBus: EventBus;
    settings: GameSettingsManager;
    terrain: TerrainData;
}

/** Register feature-provided command handlers first, then the central handlers. */
export function registerSimulationCommands(registry: CommandHandlerRegistry, deps: SimulationCommandDeps): void {
    const { state, services, eventBus, settings, terrain } = deps;
    for (const [type, handler] of services.getFeatureCommandHandlers()) {
        registry.register(type, handler);
    }
    registerAllHandlers(registry, {
        state,
        terrain,
        eventBus,
        settings: settings.state,
        settlerTaskSystem: services.settlerTaskSystem,
        constructionSiteManager: services.constructionSiteManager,
        combatSystem: services.combatSystem,
        unitReservation: services.unitReservation,
        recruitSystem: services.recruitSystem,
        unitTransformer: services.unitTransformer,
        getPlacementFilter: () => null,
        getOwner: tile => services.territoryManager.getOwner(tile),
    });
}

import type { GameState } from '../game-state';
import type { TerrainData } from '../terrain';
import type { EventBus } from '../event-bus';
import type { GameSettings } from '../game-settings';
import type { ConstructionSiteManager } from '../features/building-construction';
import type { SettlerTaskSystem } from '../features/settler-tasks';
import type { CombatSystem } from '../features/combat';
import type { StorageFilterManager } from '../features/inventory/storage-filter-manager';
import type { PlacementFilter } from '../features/placement';
import { CommandHandlerRegistry } from './handler-registry';

import {
    executeSelect,
    executeSelectAtTile,
    executeToggleSelection,
    executeSelectArea,
    executeSelectMultiple,
} from './handlers/selection-handlers';
import { executeSpawnUnit, executeMoveUnit, executeMoveSelectedUnits } from './handlers/unit-handlers';
import { executePlaceBuilding, executeRemoveEntity, executeSpawnBuildingUnits } from './handlers/building-handlers';
import {
    executePlacePile,
    executeSpawnMapObject,
    executeSpawnPile,
    executeUpdatePileQuantity,
    executeSetStorageFilter,
} from './handlers/system-handlers';
import { executeScriptAddGoods, executeScriptAddBuilding, executeScriptAddSettlers } from './handlers/script-handlers';

/**
 * All dependencies needed to register non-feature command handlers.
 * Feature-owned commands are self-registered via the plugin system.
 * This is NOT a god object passed to handlers — each handler receives
 * only the subset it needs (bound at registration time).
 */
export interface CommandRegistrationDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    settings: GameSettings;
    settlerTaskSystem: SettlerTaskSystem;
    constructionSiteManager: ConstructionSiteManager;
    combatSystem: CombatSystem;
    storageFilterManager: StorageFilterManager;
    /** Getter for placement filter — mutable, re-read on each place_building call */
    getPlacementFilter: () => PlacementFilter | null;
}

/**
 * Register non-feature command handlers with their specific dependencies bound.
 * Feature-owned commands (trees, crops, production-control) are self-registered
 * via the feature plugin system — see FeatureInstance.commands.
 */
export function registerAllHandlers(registry: CommandHandlerRegistry, deps: CommandRegistrationDeps): void {
    const {
        state,
        terrain,
        eventBus,
        settings,
        settlerTaskSystem,
        constructionSiteManager,
        combatSystem,
        storageFilterManager,
        getPlacementFilter,
    } = deps;

    // Selection — only state
    const selDeps = { state };
    registry.register('select', cmd => executeSelect(selDeps, cmd));
    registry.register('select_at_tile', cmd => executeSelectAtTile(selDeps, cmd));
    registry.register('toggle_selection', cmd => executeToggleSelection(selDeps, cmd));
    registry.register('select_area', cmd => executeSelectArea(selDeps, cmd));
    registry.register('select_multiple', cmd => executeSelectMultiple(selDeps, cmd));

    // Units
    registry.register('spawn_unit', cmd => executeSpawnUnit({ state, terrain, eventBus }, cmd));
    registry.register('move_unit', cmd => executeMoveUnit({ state, settlerTaskSystem, combatSystem }, cmd));
    registry.register('move_selected_units', cmd =>
        executeMoveSelectedUnits({ state, settlerTaskSystem, combatSystem }, cmd)
    );

    // Buildings
    // placementFilter is mutable — re-read via getter on each call
    registry.register('place_building', cmd =>
        executePlaceBuilding(
            { state, terrain, eventBus, settings, constructionSiteManager, placementFilter: getPlacementFilter() },
            cmd
        )
    );
    registry.register('remove_entity', cmd => executeRemoveEntity({ state, eventBus }, cmd));
    registry.register('spawn_building_units', cmd => executeSpawnBuildingUnits({ state, terrain, eventBus }, cmd));

    // System
    registry.register('place_pile', cmd => executePlacePile({ state, terrain, eventBus }, cmd));
    registry.register('spawn_pile', cmd => executeSpawnPile({ state, terrain, eventBus }, cmd));
    registry.register('spawn_map_object', cmd => executeSpawnMapObject({ state }, cmd));
    registry.register('update_pile_quantity', cmd => executeUpdatePileQuantity({ state }, cmd));
    registry.register('set_storage_filter', cmd => executeSetStorageFilter({ state, storageFilterManager }, cmd));

    // Script
    registry.register('script_add_goods', cmd => executeScriptAddGoods({ state, eventBus }, cmd));
    registry.register('script_add_building', cmd => executeScriptAddBuilding({ state, eventBus }, cmd));
    registry.register('script_add_settlers', cmd => executeScriptAddSettlers({ state, eventBus }, cmd));
}

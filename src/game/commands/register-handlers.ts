import type { GameState } from '../game-state';
import type { TerrainData } from '../terrain';
import type { EventBus } from '../event-bus';
import type { GameSettings } from '../game-settings';
import type { ConstructionSiteManager } from '../features/building-construction';
import type { SettlerTaskSystem } from '../features/settler-tasks';
import type { TreeSystem } from '../features/trees';
import type { CropSystem } from '../features/crops';
import type { CombatSystem } from '../features/combat';
import type { ProductionControlManager } from '../features/production-control';
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
    executePlantTree,
    executePlantTreesArea,
    executePlantCrop,
} from './handlers/system-handlers';
import { executeScriptAddGoods, executeScriptAddBuilding, executeScriptAddSettlers } from './handlers/script-handlers';
import {
    executeSetProductionMode,
    executeSetRecipeProportion,
    executeAddToProductionQueue,
    executeRemoveFromProductionQueue,
} from './handlers/production-handlers';

/**
 * All dependencies needed to register every command handler.
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
    treeSystem: TreeSystem;
    cropSystem: CropSystem;
    combatSystem: CombatSystem;
    productionControlManager: ProductionControlManager;
    storageFilterManager: StorageFilterManager;
    /** Getter for placement filter — mutable, re-read on each place_building call */
    getPlacementFilter: () => PlacementFilter | null;
}

/**
 * Register all command handlers with their specific dependencies bound.
 * Each handler receives only the deps it actually uses.
 */
export function registerAllHandlers(registry: CommandHandlerRegistry, deps: CommandRegistrationDeps): void {
    const {
        state,
        terrain,
        eventBus,
        settings,
        settlerTaskSystem,
        constructionSiteManager,
        treeSystem,
        cropSystem,
        combatSystem,
        productionControlManager,
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
    registry.register('plant_tree', cmd => executePlantTree({ state, eventBus, treeSystem }, cmd));
    registry.register('plant_trees_area', cmd => executePlantTreesArea({ treeSystem }, cmd));
    registry.register('plant_crop', cmd => executePlantCrop({ state, eventBus, cropSystem }, cmd));

    // Script
    registry.register('script_add_goods', cmd => executeScriptAddGoods({ state, eventBus }, cmd));
    registry.register('script_add_building', cmd => executeScriptAddBuilding({ state, eventBus }, cmd));
    registry.register('script_add_settlers', cmd => executeScriptAddSettlers({ state, eventBus }, cmd));

    // Production
    const prodDeps = { productionControlManager };
    registry.register('set_production_mode', cmd => executeSetProductionMode(prodDeps, cmd));
    registry.register('set_recipe_proportion', cmd => executeSetRecipeProportion(prodDeps, cmd));
    registry.register('add_to_production_queue', cmd => executeAddToProductionQueue(prodDeps, cmd));
    registry.register('remove_from_production_queue', cmd => executeRemoveFromProductionQueue(prodDeps, cmd));
}

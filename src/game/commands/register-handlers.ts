import type { GameState } from '../game-state';
import type { TerrainData } from '../terrain';
import type { EventBus } from '../event-bus';
import type { GameSettings } from '../game-settings';
import type { ConstructionSiteManager } from '../features/building-construction';
import type { SettlerTaskSystem } from '../features/settler-tasks';
import type { CombatSystem } from '../features/combat';
import type { StorageFilterManager } from '../systems/inventory/storage-filter-manager';
import type { BuildingInventoryManager } from '../systems/inventory/building-inventory';
import type { PlacementFilter } from '../systems/placement';
import type { UnitReservationRegistry } from '../systems/unit-reservation';
import type { RecruitSystem } from '../systems/recruit/recruit-system';
import type { UnitTransformer } from '../systems/recruit/unit-transformer';
import { CommandHandlerRegistry } from './handler-registry';

import {
    executeSelect,
    executeSelectAtTile,
    executeToggleSelection,
    executeSelectArea,
    executeSelectMultiple,
    executeSelectSameUnitType,
} from './handlers/selection-handlers';
import {
    executeSpawnUnit,
    executeMoveUnit,
    executeMoveSelectedUnits,
    executeRecruitSpecialist,
} from './handlers/unit-handlers';
import { executePlaceBuilding, executeRemoveEntity, executeSpawnBuildingUnits } from './handlers/building-handlers';
import {
    executePlacePile,
    executeSpawnMapObject,
    executeSpawnPile,
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
    inventoryManager: BuildingInventoryManager;
    unitReservation: UnitReservationRegistry;
    /** Getter for placement filter — mutable, re-read on each place_building call */
    getPlacementFilter: () => PlacementFilter | null;
    recruitSystem: RecruitSystem;
    unitTransformer: UnitTransformer;
    /** Territory owner lookup for assigning player to free piles */
    getOwner: (x: number, y: number) => number;
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
        inventoryManager,
        unitReservation,
        getPlacementFilter,
        recruitSystem,
        unitTransformer,
        getOwner,
    } = deps;

    // Selection — only state
    const selDeps = { state };
    registry.register('select', cmd => executeSelect(selDeps, cmd));
    registry.register('select_at_tile', cmd => executeSelectAtTile(selDeps, cmd));
    registry.register('toggle_selection', cmd => executeToggleSelection(selDeps, cmd));
    registry.register('select_area', cmd => executeSelectArea(selDeps, cmd));
    registry.register('select_multiple', cmd => executeSelectMultiple(selDeps, cmd));
    registry.register('select_same_unit_type', cmd => executeSelectSameUnitType(selDeps, cmd));

    // Units
    registry.register('spawn_unit', cmd => executeSpawnUnit({ state, terrain, eventBus }, cmd));
    registry.register('recruit_specialist', cmd => executeRecruitSpecialist({ recruitSystem, unitTransformer }, cmd));
    const isCombatControllable = () => settings.combatControllable;
    registry.register('move_unit', cmd =>
        executeMoveUnit({ state, settlerTaskSystem, combatSystem, unitReservation, isCombatControllable }, cmd)
    );
    registry.register('move_selected_units', cmd =>
        executeMoveSelectedUnits({ state, settlerTaskSystem, combatSystem, unitReservation, isCombatControllable }, cmd)
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
    registry.register('place_pile', cmd => executePlacePile({ state, terrain, eventBus, getOwner }, cmd));
    registry.register('spawn_pile', cmd => executeSpawnPile({ state, terrain, eventBus }, cmd));
    registry.register('spawn_map_object', cmd => executeSpawnMapObject({ state }, cmd));
    registry.register('set_storage_filter', cmd =>
        executeSetStorageFilter({ state, eventBus, storageFilterManager, inventoryManager }, cmd)
    );

    // Script
    registry.register('script_add_goods', cmd => executeScriptAddGoods({ state, eventBus }, cmd));
    registry.register('script_add_building', cmd => executeScriptAddBuilding({ state, eventBus }, cmd));
    registry.register('script_add_settlers', cmd => executeScriptAddSettlers({ state, eventBus }, cmd));
}

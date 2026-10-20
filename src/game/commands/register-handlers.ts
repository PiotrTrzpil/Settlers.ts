import type { GameState } from '../game-state';
import type { TerrainData } from '../terrain';
import type { EventBus } from '../event-bus';
import { CommandHandlerRegistry } from './handler-registry';

import {
    executeSelect,
    executeSelectAtTile,
    executeToggleSelection,
    executeSelectArea,
    executeSelectMultiple,
    executeSelectSameUnitType,
} from './handlers/selection-handlers';
import { executeSpawnUnit } from './handlers/unit-handlers';
import { executeRemoveEntity } from './handlers/building-handlers';
import { executeSpawnMapObject, executeSpawnPile } from './handlers/system-handlers';
import { executeScriptAddGoods, executeScriptAddBuilding, executeScriptAddSettlers } from './handlers/script-handlers';

/**
 * Dependencies of the central (kernel-level) command handlers.
 * Commands that mutate a feature's state are owned by that feature and
 * self-registered via FeatureInstance.commands — they never appear here.
 * Each handler receives only the subset it needs (bound at registration time).
 */
export interface CommandRegistrationDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

/**
 * Register the central command handlers: selection, raw entity spawning/removal and
 * map-script commands, which need only kernel state. Feature-owned commands
 * (placement, movement, recruitment, inventory, garrisons, trees, …) are self-registered
 * via the feature plugin system — see FeatureInstance.commands.
 */
export function registerAllHandlers(registry: CommandHandlerRegistry, deps: CommandRegistrationDeps): void {
    const { state, terrain, eventBus } = deps;

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

    // Entities
    registry.register('remove_entity', cmd => executeRemoveEntity({ state, eventBus }, cmd));

    // System
    registry.register('spawn_pile', cmd => executeSpawnPile({ state, terrain, eventBus }, cmd));
    registry.register('spawn_map_object', cmd => executeSpawnMapObject({ state }, cmd));

    // Script
    registry.register('script_add_goods', cmd => executeScriptAddGoods({ state, eventBus, terrain }, cmd));
    registry.register('script_add_building', cmd => executeScriptAddBuilding({ state, eventBus, terrain }, cmd));
    registry.register('script_add_settlers', cmd => executeScriptAddSettlers({ state, eventBus, terrain }, cmd));
}

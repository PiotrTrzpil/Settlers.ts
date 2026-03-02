import { BuildingType, UnitType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import type { Race } from '../race';
import type { EMaterialType } from '../economy/material-type';

/**
 * Formation offsets for multi-unit movement commands.
 * Units spread out in an expanding spiral pattern around the target.
 */
export const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [2, 0],
    [0, 2],
    [-2, 0],
    [0, -2],
    [2, 1],
    [1, 2],
    [-1, 2],
    [-2, 1],
    [-2, -1],
    [-1, -2],
    [1, -2],
    [2, -1],
    [2, 2],
    [-2, 2],
    [2, -2],
    [-2, -2],
];

// === Building Commands ===

export interface PlaceBuildingCommand {
    type: 'place_building';
    buildingType: BuildingType;
    x: number;
    y: number;
    player: number;
    /** Race for the building sprite (Race enum value) */
    race: Race;
    /** Spawn the building's dedicated worker at the door position. */
    spawnWorker?: boolean;
}

export interface PlaceResourceCommand {
    type: 'place_resource';
    materialType: number; // EMaterialType
    amount: number;
    x: number;
    y: number;
}

export interface RemoveEntityCommand {
    type: 'remove_entity';
    entityId: number;
}

// === Unit Commands ===

export interface SpawnUnitCommand {
    type: 'spawn_unit';
    unitType: UnitType;
    x: number;
    y: number;
    player: number;
    /** Race for the unit sprite (Race enum value) */
    race: Race;
    /** Military unit level (1-3). Defaults to 1. */
    level?: number;
}

export interface MoveUnitCommand {
    type: 'move_unit';
    entityId: number;
    targetX: number;
    targetY: number;
}

export interface MoveSelectedUnitsCommand {
    type: 'move_selected_units';
    targetX: number;
    targetY: number;
}

// === System Commands (internal, not player-initiated) ===

export interface SpawnVisualResourceCommand {
    type: 'spawn_visual_resource';
    materialType: EMaterialType;
    x: number;
    y: number;
    player: number;
    quantity: number;
    /** If set, marks the resource as reserved for this building */
    buildingId?: number;
}

export interface SpawnBuildingUnitsCommand {
    type: 'spawn_building_units';
    buildingEntityId: number;
}

export interface PlantTreeCommand {
    type: 'plant_tree';
    treeType: MapObjectType;
    x: number;
    y: number;
}

export interface PlantCropCommand {
    type: 'plant_crop';
    cropType: MapObjectType;
    x: number;
    y: number;
}

export interface PlantTreesAreaCommand {
    type: 'plant_trees_area';
    centerX: number;
    centerY: number;
    count: number;
    /** Search radius in tiles (default: 15) */
    radius?: number;
}

// === Production Control Commands ===

export interface SetProductionModeCommand {
    type: 'set_production_mode';
    buildingId: number;
    mode: 'even' | 'proportional' | 'manual';
}

export interface SetRecipeProportionCommand {
    type: 'set_recipe_proportion';
    buildingId: number;
    /** The output material whose proportion to change */
    output: EMaterialType;
    /** Weight value (0-10) */
    weight: number;
}

export interface AddToProductionQueueCommand {
    type: 'add_to_production_queue';
    buildingId: number;
    /** The output material to add to the queue */
    output: EMaterialType;
}

export interface RemoveFromProductionQueueCommand {
    type: 'remove_from_production_queue';
    buildingId: number;
    /** The output material to remove from the queue (last occurrence) */
    output: EMaterialType;
}

// === Script Commands (from Lua scripting API) ===

export interface ScriptAddGoodsCommand {
    type: 'script_add_goods';
    materialType: number;
    x: number;
    y: number;
    amount: number;
}

export interface ScriptAddBuildingCommand {
    type: 'script_add_building';
    buildingType: number;
    x: number;
    y: number;
    player: number;
    /** Race for the building sprite (Race enum value) */
    race: Race;
}

export interface ScriptAddSettlersCommand {
    type: 'script_add_settlers';
    unitType: number;
    x: number;
    y: number;
    player: number;
    amount: number;
    /** Race for the unit sprite (Race enum value) */
    race: Race;
}

// === Selection Commands ===

export interface SelectCommand {
    type: 'select';
    entityId: number | null;
}

export interface SelectAtTileCommand {
    type: 'select_at_tile';
    x: number;
    y: number;
    addToSelection: boolean;
}

export interface ToggleSelectionCommand {
    type: 'toggle_selection';
    entityId: number;
}

export interface SelectAreaCommand {
    type: 'select_area';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/**
 * Union type of all game commands.
 */
export type Command =
    | PlaceBuildingCommand
    | PlaceResourceCommand
    | SpawnUnitCommand
    | MoveUnitCommand
    | SelectCommand
    | SelectAtTileCommand
    | ToggleSelectionCommand
    | SelectAreaCommand
    | MoveSelectedUnitsCommand
    | RemoveEntityCommand
    | SpawnVisualResourceCommand
    | SpawnBuildingUnitsCommand
    | PlantTreeCommand
    | PlantCropCommand
    | PlantTreesAreaCommand
    | ScriptAddGoodsCommand
    | ScriptAddBuildingCommand
    | ScriptAddSettlersCommand
    | SetProductionModeCommand
    | SetRecipeProportionCommand
    | AddToProductionQueueCommand
    | RemoveFromProductionQueueCommand;

// === Command Result Types ===

/**
 * Effect produced by a command execution.
 * Used for debugging, replay, and undo functionality.
 */
export type CommandEffect =
    | { type: 'entity_created'; entityId: number; entityType: string }
    | { type: 'entity_removed'; entityId: number }
    | { type: 'entity_moved'; entityId: number; fromX: number; fromY: number; toX: number; toY: number }
    | { type: 'selection_changed'; selectedIds: number[] }
    | { type: 'building_placed'; entityId: number; buildingType: BuildingType; x: number; y: number }
    | { type: 'unit_spawned'; entityId: number; unitType: UnitType; x: number; y: number }
    | { type: 'tree_planted'; entityId: number; treeType: MapObjectType; x: number; y: number }
    | { type: 'crop_planted'; entityId: number; cropType: MapObjectType; x: number; y: number };

/**
 * Result of command execution.
 * Provides detailed feedback for debugging, replay, and UI feedback.
 */
export interface CommandResult {
    /** Whether the command executed successfully */
    success: boolean;

    /**
     * Error message if command failed.
     * Provides context for debugging and user feedback.
     */
    error?: string;

    /**
     * Effects produced by the command.
     * Used for debugging, replay, and undo functionality.
     */
    effects?: CommandEffect[];
}

/** Successful command result with no effects */
export const COMMAND_OK: CommandResult = { success: true };

/** Create a successful result with effects */
export function commandSuccess(effects?: CommandEffect[]): CommandResult {
    return effects ? { success: true, effects } : COMMAND_OK;
}

/** Create a failed result with error message */
export function commandFailed(error: string): CommandResult {
    return { success: false, error };
}

/**
 * Type guard for building-related commands.
 */
export function isBuildingCommand(cmd: Command): cmd is PlaceBuildingCommand | RemoveEntityCommand {
    return cmd.type === 'place_building' || cmd.type === 'remove_entity';
}

/**
 * Type guard for resource-related commands.
 */
export function isResourceCommand(cmd: Command): cmd is PlaceResourceCommand {
    return cmd.type === 'place_resource';
}

/**
 * Type guard for unit-related commands.
 */
export function isUnitCommand(cmd: Command): cmd is SpawnUnitCommand | MoveUnitCommand | MoveSelectedUnitsCommand {
    return cmd.type === 'spawn_unit' || cmd.type === 'move_unit' || cmd.type === 'move_selected_units';
}

/**
 * Type guard for selection-related commands.
 */
export function isSelectionCommand(
    cmd: Command
): cmd is SelectCommand | SelectAtTileCommand | ToggleSelectionCommand | SelectAreaCommand {
    return (
        cmd.type === 'select' ||
        cmd.type === 'select_at_tile' ||
        cmd.type === 'toggle_selection' ||
        cmd.type === 'select_area'
    );
}

/**
 * Type guard for movement commands.
 */
export function isMovementCommand(cmd: Command): cmd is MoveUnitCommand | MoveSelectedUnitsCommand {
    return cmd.type === 'move_unit' || cmd.type === 'move_selected_units';
}

/** Type guard for production control commands. */
export function isProductionControlCommand(
    cmd: Command
): cmd is
    | SetProductionModeCommand
    | SetRecipeProportionCommand
    | AddToProductionQueueCommand
    | RemoveFromProductionQueueCommand {
    return (
        cmd.type === 'set_production_mode' ||
        cmd.type === 'set_recipe_proportion' ||
        cmd.type === 'add_to_production_queue' ||
        cmd.type === 'remove_from_production_queue'
    );
}

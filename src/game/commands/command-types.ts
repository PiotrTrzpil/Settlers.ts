import { BuildingType, UnitType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { ProductionMode } from '../features/production-control';
import type { Race } from '../core/race';
import type { EMaterialType } from '../economy/material-type';
import type { PileKind } from '../core/pile-kind';
import { StorageDirection } from '../systems/inventory/storage-filter-manager';

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
    /** Race override — defaults to player race from GameState.playerRaces. */
    race?: Race;
    /** Spawn the building's dedicated worker at the door position. */
    spawnWorker?: boolean;
    /** When true, skip construction and mark the building as immediately operational. */
    completed?: boolean;
    /** When true, skip placement validation (from grid-backed UI where positions are precomputed). */
    trusted?: boolean;
}

export interface PlacePileCommand {
    type: 'place_pile';
    materialType: EMaterialType;
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
    /** Race override — defaults to player race from GameState.playerRaces. */
    race?: Race;
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

export interface SpawnPileCommand {
    type: 'spawn_pile';
    materialType: EMaterialType;
    x: number;
    y: number;
    player: number;
    quantity: number;
    kind: PileKind;
}

export interface SpawnMapObjectCommand {
    type: 'spawn_map_object';
    objectType: MapObjectType;
    x: number;
    y: number;
    /** Optional sprite variation override */
    variation?: number;
}

export interface SetStorageFilterCommand {
    type: 'set_storage_filter';
    buildingId: number;
    material: EMaterialType;
    /** Direction to set, or null to disable this material entirely. */
    direction: StorageDirection | null;
}

export interface SpawnBuildingUnitsCommand {
    type: 'spawn_building_units';
    buildingEntityId: number;
    /** When true, the building was placed as instantly completed (skip construction workers). */
    placedCompleted?: boolean;
    /** When true, spawn the building's dedicated worker at the door. */
    spawnWorker?: boolean;
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
    mode: ProductionMode;
}

export interface SetRecipeProportionCommand {
    type: 'set_recipe_proportion';
    buildingId: number;
    /** Index of the recipe in the building's RecipeSet whose proportion to change */
    recipeIndex: number;
    /** Weight value (0-10) */
    weight: number;
}

export interface AddToProductionQueueCommand {
    type: 'add_to_production_queue';
    buildingId: number;
    /** Index of the recipe in the building's RecipeSet to add to the queue */
    recipeIndex: number;
}

export interface RemoveFromProductionQueueCommand {
    type: 'remove_from_production_queue';
    buildingId: number;
    /** Index of the recipe in the building's RecipeSet to remove from the queue (last occurrence) */
    recipeIndex: number;
}

// === Script Commands (from Lua scripting API) ===

export interface ScriptAddGoodsCommand {
    type: 'script_add_goods';
    materialType: number | string;
    x: number;
    y: number;
    amount: number;
}

export interface ScriptAddBuildingCommand {
    type: 'script_add_building';
    buildingType: BuildingType;
    x: number;
    y: number;
    player: number;
    /** Race override — defaults to player race from GameState.playerRaces. */
    race?: Race;
}

export interface ScriptAddSettlersCommand {
    type: 'script_add_settlers';
    unitType: UnitType;
    x: number;
    y: number;
    player: number;
    amount: number;
    /** Race override — defaults to player race from GameState.playerRaces. */
    race?: Race;
}

// === Specialist Recruitment Commands ===

export interface RecruitSpecialistCommand {
    type: 'recruit_specialist';
    unitType: UnitType;
    /** Positive = enqueue N. Negative = dequeue N (e.g. -1 for the -1 button). */
    count: number;
    player: number;
    race: Race;
    /** Camera center tile at the time of the command. Used to find the nearest tool / carrier. */
    nearX?: number;
    nearY?: number;
}

// === Siege Commands (internal, not player-initiated) ===

/** Internal command: siege system captures a building (changes ownership). */
export interface CaptureBuildingCommand {
    type: 'capture_building';
    buildingId: number;
    newPlayer: number;
}

// === Garrison Commands ===

export interface GarrisonUnitsCommand {
    type: 'garrison_units';
    buildingId: number;
    /** Unit IDs to attempt to garrison. Handler filters to those that fit. */
    unitIds: number[];
}

export interface UngarrisonUnitCommand {
    type: 'ungarrison_unit';
    buildingId: number;
    unitId: number;
}

/** Garrison all currently selected military units into a building at the given tile. */
export interface GarrisonSelectedUnitsCommand {
    type: 'garrison_selected_units';
    tileX: number;
    tileY: number;
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

export interface SelectMultipleCommand {
    type: 'select_multiple';
    entityIds: number[];
}

export interface SelectSameUnitTypeCommand {
    type: 'select_same_unit_type';
    /** The entity whose subType we want to match. */
    seedEntityId: number;
    /** Candidate entity IDs to filter (e.g. from a screen-space pick). */
    candidateIds: number[];
}

/**
 * Union type of all game commands.
 */
export type Command =
    | PlaceBuildingCommand
    | PlacePileCommand
    | SpawnUnitCommand
    | MoveUnitCommand
    | SelectCommand
    | SelectAtTileCommand
    | ToggleSelectionCommand
    | SelectAreaCommand
    | SelectMultipleCommand
    | SelectSameUnitTypeCommand
    | MoveSelectedUnitsCommand
    | RemoveEntityCommand
    | SpawnPileCommand
    | SpawnMapObjectCommand
    | SetStorageFilterCommand
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
    | RemoveFromProductionQueueCommand
    | GarrisonUnitsCommand
    | UngarrisonUnitCommand
    | GarrisonSelectedUnitsCommand
    | RecruitSpecialistCommand
    | CaptureBuildingCommand;

/** Union of all command type string literals. */
export type CommandType = Command['type'];

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
export function isPileCommand(cmd: Command): cmd is PlacePileCommand {
    return cmd.type === 'place_pile';
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
): cmd is
    | SelectCommand
    | SelectAtTileCommand
    | ToggleSelectionCommand
    | SelectAreaCommand
    | SelectMultipleCommand
    | SelectSameUnitTypeCommand {
    return (
        cmd.type === 'select' ||
        cmd.type === 'select_at_tile' ||
        cmd.type === 'toggle_selection' ||
        cmd.type === 'select_area' ||
        cmd.type === 'select_multiple' ||
        cmd.type === 'select_same_unit_type'
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

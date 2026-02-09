import { BuildingType, UnitType } from '../entity';

/**
 * Formation offsets for multi-unit movement commands.
 * Units spread out in an expanding spiral pattern around the target.
 */
export const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [-2, -1], [-1, -2], [1, -2], [2, -1],
    [2, 2], [-2, 2], [2, -2], [-2, -2],
];

// === Building Commands ===

export interface PlaceBuildingCommand {
    type: 'place_building';
    buildingType: BuildingType;
    x: number;
    y: number;
    player: number;
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
    | RemoveEntityCommand;

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
export function isSelectionCommand(cmd: Command): cmd is SelectCommand | SelectAtTileCommand | ToggleSelectionCommand | SelectAreaCommand {
    return cmd.type === 'select' || cmd.type === 'select_at_tile' ||
        cmd.type === 'toggle_selection' || cmd.type === 'select_area';
}

/**
 * Type guard for movement commands.
 */
export function isMovementCommand(cmd: Command): cmd is MoveUnitCommand | MoveSelectedUnitsCommand {
    return cmd.type === 'move_unit' || cmd.type === 'move_selected_units';
}

/**
 * Commands Module — Public API
 *
 * All external code should import from this barrel file.
 */

// Command types and type guards
export type {
    Command,
    PlaceBuildingCommand,
    PlaceResourceCommand,
    SpawnUnitCommand,
    MoveUnitCommand,
    SelectCommand,
    SelectAtTileCommand,
    ToggleSelectionCommand,
    SelectAreaCommand,
    MoveSelectedUnitsCommand,
    RemoveEntityCommand,
    CommandResult,
    CommandEffect,
} from './command-types';

export {
    FORMATION_OFFSETS,
    isBuildingCommand,
    isUnitCommand,
    isResourceCommand,
    isSelectionCommand,
    isMovementCommand,
    COMMAND_OK,
    commandSuccess,
    commandFailed,
} from './command-types';

// Command execution
export { executeCommand } from './command';

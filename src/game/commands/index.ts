/**
 * Commands Module — Public API
 *
 * All external code should import from this barrel file.
 */

// Command types and type guards
export type {
    Command,
    PlaceBuildingCommand,
    PlacePileCommand as PlaceResourceCommand,
    SpawnUnitCommand,
    MoveUnitCommand,
    SelectCommand,
    SelectAtTileCommand,
    ToggleSelectionCommand,
    SelectAreaCommand,
    MoveSelectedUnitsCommand,
    RemoveEntityCommand,
    SpawnPileCommand,
    SpawnMapObjectCommand,
    UpdatePileQuantityCommand,
    SetStorageFilterCommand,
    SpawnBuildingUnitsCommand,
    PlantTreeCommand,
    ScriptAddGoodsCommand,
    ScriptAddBuildingCommand,
    ScriptAddSettlersCommand,
    CommandResult,
    CommandEffect,
} from './command-types';

export {
    FORMATION_OFFSETS,
    isBuildingCommand,
    isUnitCommand,
    isPileCommand as isResourceCommand,
    isSelectionCommand,
    isMovementCommand,
    COMMAND_OK,
    commandSuccess,
    commandFailed,
} from './command-types';

// Command execution
export { executeCommand } from './command';
export type { CommandContext } from './command';

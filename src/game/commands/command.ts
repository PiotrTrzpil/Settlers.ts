import { EntityType, EXTENDED_OFFSETS, BUILDING_UNIT_TYPE, tileKey } from '../entity';
import { BuildingConstructionPhase, type BuildingStateManager } from '../features/building-construction';
import { GameState } from '../game-state';
import { canPlaceBuildingFootprint, isPassable } from '../features/placement';
import { MapSize } from '@/utilities/map-size';
import type { EventBus } from '../event-bus';
import { gameSettings } from '../game-settings';
import type { SettlerTaskSystem } from '../systems/settler-tasks';
import {
    Command,
    FORMATION_OFFSETS,
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
    type CommandResult,
    commandSuccess,
    commandFailed,
} from './command-types';

// Re-export Command type and related types for backward compatibility
export type { Command, CommandResult, CommandEffect } from './command-types';
export type {
    PlaceBuildingCommand,
    SpawnUnitCommand,
    MoveUnitCommand,
    SelectCommand,
    SelectAtTileCommand,
    ToggleSelectionCommand,
    SelectAreaCommand,
    MoveSelectedUnitsCommand,
    RemoveEntityCommand,
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

interface CommandContext {
    state: GameState;
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapSize: MapSize;
    eventBus: EventBus;
    /** Optional task system for routing movement through tasks */
    settlerTaskSystem?: SettlerTaskSystem;
    /** Building state manager for construction phases */
    buildingStateManager: BuildingStateManager;
}

function executePlaceBuilding(ctx: CommandContext, cmd: PlaceBuildingCommand): CommandResult {
    const { state, groundType, groundHeight, mapSize } = ctx;

    if (
        !canPlaceBuildingFootprint(
            groundType,
            groundHeight,
            mapSize,
            state.tileOccupancy,
            cmd.x,
            cmd.y,
            cmd.buildingType
        )
    ) {
        return commandFailed(`Cannot place building at (${cmd.x}, ${cmd.y}): invalid placement`);
    }

    const entity = state.addEntity(EntityType.Building, cmd.buildingType, cmd.x, cmd.y, cmd.player);

    // If "place as completed" is enabled, immediately mark building as completed
    if (gameSettings.state.placeBuildingsCompleted) {
        const buildingState = ctx.buildingStateManager.getBuildingState(entity.id);
        if (buildingState) {
            buildingState.phase = BuildingConstructionPhase.Completed;
            buildingState.phaseProgress = 1;
            buildingState.elapsedTime = buildingState.totalDuration;
        }
    }

    ctx.eventBus.emit('building:placed', {
        entityId: entity.id,
        buildingType: cmd.buildingType,
        x: cmd.x,
        y: cmd.y,
        player: cmd.player,
    });

    // Spawn dedicated worker if "place with worker" is enabled
    if (gameSettings.state.placeBuildingsWithWorker) {
        spawnWorkerForBuilding(ctx, cmd);
    }

    return commandSuccess([
        { type: 'building_placed', entityId: entity.id, buildingType: cmd.buildingType, x: cmd.x, y: cmd.y },
    ]);
}

function spawnWorkerForBuilding(ctx: CommandContext, cmd: PlaceBuildingCommand): void {
    const workerType = BUILDING_UNIT_TYPE[cmd.buildingType];
    if (workerType === undefined) {
        return;
    }

    // Get building entity ID before spawning worker (it occupies the tile now)
    const building = ctx.state.getEntityAt(cmd.x, cmd.y);

    // Spawn worker at building location - don't check for occupancy
    const entity = ctx.state.addEntity(EntityType.Unit, workerType, cmd.x, cmd.y, cmd.player);

    // Restore building's tile occupancy - workers "work inside" buildings
    // and shouldn't claim the building's tile
    if (building) {
        ctx.state.tileOccupancy.set(tileKey(cmd.x, cmd.y), building.id);
    }

    ctx.eventBus.emit('unit:spawned', {
        entityId: entity.id,
        unitType: workerType,
        x: cmd.x,
        y: cmd.y,
        player: cmd.player,
    });
}

function executeSpawnUnit(ctx: CommandContext, cmd: SpawnUnitCommand): CommandResult {
    const { state, groundType, mapSize } = ctx;

    const isTileValid = (x: number, y: number) =>
        x >= 0 &&
        x < mapSize.width &&
        y >= 0 &&
        y < mapSize.height &&
        isPassable(groundType[mapSize.toIndex(x, y)]) &&
        !state.getEntityAt(x, y);

    let spawnX = cmd.x;
    let spawnY = cmd.y;

    if (!isTileValid(spawnX, spawnY)) {
        const found = findValidSpawnTile(cmd.x, cmd.y, isTileValid);
        if (!found) {
            return commandFailed(`Cannot spawn unit at (${cmd.x}, ${cmd.y}): no valid tile nearby`);
        }
        spawnX = found.x;
        spawnY = found.y;
    }

    const entity = state.addEntity(EntityType.Unit, cmd.unitType, spawnX, spawnY, cmd.player);

    ctx.eventBus.emit('unit:spawned', {
        entityId: entity.id,
        unitType: cmd.unitType,
        x: spawnX,
        y: spawnY,
        player: cmd.player,
    });

    return commandSuccess([
        { type: 'unit_spawned', entityId: entity.id, unitType: cmd.unitType, x: spawnX, y: spawnY },
    ]);
}

function findValidSpawnTile(
    x: number,
    y: number,
    isValid: (x: number, y: number) => boolean
): { x: number; y: number } | null {
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isValid(nx, ny)) {
            return { x: nx, y: ny };
        }
    }
    return null;
}

function executeMoveUnit(ctx: CommandContext, cmd: MoveUnitCommand): CommandResult {
    const entity = ctx.state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }

    const fromX = entity.x;
    const fromY = entity.y;

    // Route through task system if available (handles animation)
    const success = ctx.settlerTaskSystem
        ? ctx.settlerTaskSystem.assignMoveTask(cmd.entityId, cmd.targetX, cmd.targetY)
        : ctx.state.movement.moveUnit(cmd.entityId, cmd.targetX, cmd.targetY);

    if (!success) {
        return commandFailed(`Cannot move unit ${cmd.entityId} to (${cmd.targetX}, ${cmd.targetY})`);
    }

    return commandSuccess([
        { type: 'entity_moved', entityId: cmd.entityId, fromX, fromY, toX: cmd.targetX, toY: cmd.targetY },
    ]);
}

function executeSelect(ctx: CommandContext, cmd: SelectCommand): CommandResult {
    const { state } = ctx;

    if (cmd.entityId !== null) {
        const ent = state.getEntity(cmd.entityId);
        if (ent && ent.selectable === false) {
            state.selectedEntityId = null;
            state.selectedEntityIds.clear();
            return commandSuccess([{ type: 'selection_changed', selectedIds: [] }]);
        }
    }

    state.selectedEntityId = cmd.entityId;
    state.selectedEntityIds.clear();
    if (cmd.entityId !== null) {
        state.selectedEntityIds.add(cmd.entityId);
    }

    return commandSuccess([{ type: 'selection_changed', selectedIds: cmd.entityId !== null ? [cmd.entityId] : [] }]);
}

function executeSelectAtTile(ctx: CommandContext, cmd: SelectAtTileCommand): CommandResult {
    const { state } = ctx;
    const rawEntity = state.getEntityAt(cmd.x, cmd.y);
    const entity = rawEntity?.selectable !== false ? rawEntity : undefined;

    if (cmd.addToSelection) {
        toggleEntityInSelection(state, entity);
        return commandSuccess([{ type: 'selection_changed', selectedIds: [...state.selectedEntityIds] }]);
    }

    // Replace selection
    state.selectedEntityIds.clear();
    state.selectedEntityId = entity?.id ?? null;
    if (entity) {
        state.selectedEntityIds.add(entity.id);
    }

    return commandSuccess([{ type: 'selection_changed', selectedIds: entity ? [entity.id] : [] }]);
}

function toggleEntityInSelection(state: GameState, entity: { id: number } | undefined): void {
    if (!entity) return;

    if (state.selectedEntityIds.has(entity.id)) {
        state.selectedEntityIds.delete(entity.id);
        if (state.selectedEntityId === entity.id) {
            state.selectedEntityId =
                state.selectedEntityIds.size > 0 ? state.selectedEntityIds.values().next().value! : null;
        }
    } else {
        state.selectedEntityIds.add(entity.id);
        if (state.selectedEntityId === null) {
            state.selectedEntityId = entity.id;
        }
    }
}

function executeToggleSelection(ctx: CommandContext, cmd: ToggleSelectionCommand): CommandResult {
    const { state } = ctx;
    const entity = state.getEntity(cmd.entityId);
    if (!entity || entity.selectable === false) {
        return commandFailed(`Entity ${cmd.entityId} is not selectable`);
    }

    toggleEntityInSelection(state, entity);
    return commandSuccess([{ type: 'selection_changed', selectedIds: [...state.selectedEntityIds] }]);
}

function executeSelectArea(ctx: CommandContext, cmd: SelectAreaCommand): CommandResult {
    const { state } = ctx;
    const allEntities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
    const entities = allEntities.filter(e => e.selectable !== false);

    // Prefer selecting units over buildings
    const units = entities.filter(e => e.type === EntityType.Unit);
    const toSelect = units.length > 0 ? units : entities;

    state.selectedEntityIds.clear();
    for (const e of toSelect) {
        state.selectedEntityIds.add(e.id);
    }
    state.selectedEntityId = toSelect.length > 0 ? toSelect[0].id : null;

    return commandSuccess([{ type: 'selection_changed', selectedIds: toSelect.map(e => e.id) }]);
}

function executeMoveSelectedUnits(ctx: CommandContext, cmd: MoveSelectedUnitsCommand): CommandResult {
    const { state, settlerTaskSystem } = ctx;

    const selectedUnits: number[] = [];
    for (const entityId of state.selectedEntityIds) {
        const e = state.getEntity(entityId);
        if (e && e.type === EntityType.Unit) {
            selectedUnits.push(entityId);
        }
    }
    if (selectedUnits.length === 0) {
        return commandFailed('No units selected');
    }

    const effects: {
        type: 'entity_moved';
        entityId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
    }[] = [];
    for (let i = 0; i < selectedUnits.length; i++) {
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
        const targetX = cmd.targetX + offset[0];
        const targetY = cmd.targetY + offset[1];

        const entity = state.getEntity(selectedUnits[i]);
        if (!entity) continue;

        const fromX = entity.x;
        const fromY = entity.y;

        // Route through task system if available (handles animation)
        const moved = settlerTaskSystem
            ? settlerTaskSystem.assignMoveTask(selectedUnits[i], targetX, targetY)
            : state.movement.moveUnit(selectedUnits[i], targetX, targetY);

        if (moved) {
            effects.push({
                type: 'entity_moved',
                entityId: selectedUnits[i],
                fromX,
                fromY,
                toX: targetX,
                toY: targetY,
            });
        }
    }

    if (effects.length === 0) {
        return commandFailed(`Could not move any of ${selectedUnits.length} selected units`);
    }

    return commandSuccess(effects);
}

function executeRemoveEntity(ctx: CommandContext, cmd: RemoveEntityCommand): CommandResult {
    const { state } = ctx;
    const entity = state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }

    if (entity.type === EntityType.Building) {
        const bs = ctx.buildingStateManager.getBuildingState(cmd.entityId);
        if (bs) {
            ctx.eventBus.emit('building:removed', { entityId: cmd.entityId, buildingState: bs });
        }
    }

    state.removeEntity(cmd.entityId);
    return commandSuccess([{ type: 'entity_removed', entityId: cmd.entityId }]);
}

function executePlaceResource(ctx: CommandContext, cmd: PlaceResourceCommand): CommandResult {
    const { state, mapSize, groundType } = ctx;

    if (cmd.x < 0 || cmd.x >= mapSize.width || cmd.y < 0 || cmd.y >= mapSize.height) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is out of bounds`);
    }

    // Check passability (not sea/rock)
    if (!isPassable(groundType[mapSize.toIndex(cmd.x, cmd.y)])) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is not passable`);
    }

    // Check if tile is occupied
    if (state.getEntityAt(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is already occupied`);
    }

    // Create a StackedResource entity for the material
    const entity = state.addEntity(EntityType.StackedResource, cmd.materialType, cmd.x, cmd.y, 0);

    // Update quantity in resource state
    const resourceState = state.resourceStates.get(entity.id);
    if (resourceState) {
        resourceState.quantity = cmd.amount;
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedResource' }]);
}

/**
 * Execute a player command against the game state.
 * Returns a CommandResult with success status, error details, and effects.
 */
export function executeCommand(
    state: GameState,
    cmd: Command,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    eventBus: EventBus,
    settlerTaskSystem: SettlerTaskSystem | undefined,
    buildingStateManager: BuildingStateManager
): CommandResult {
    const ctx: CommandContext = {
        state,
        groundType,
        groundHeight,
        mapSize,
        eventBus,
        settlerTaskSystem,
        buildingStateManager,
    };

    switch (cmd.type) {
    case 'place_building':
        return executePlaceBuilding(ctx, cmd);
    case 'place_resource':
        return executePlaceResource(ctx, cmd);
    case 'spawn_unit':
        return executeSpawnUnit(ctx, cmd);
    case 'move_unit':
        return executeMoveUnit(ctx, cmd);
    case 'select':
        return executeSelect(ctx, cmd);
    case 'select_at_tile':
        return executeSelectAtTile(ctx, cmd);
    case 'toggle_selection':
        return executeToggleSelection(ctx, cmd);
    case 'select_area':
        return executeSelectArea(ctx, cmd);
    case 'move_selected_units':
        return executeMoveSelectedUnits(ctx, cmd);
    case 'remove_entity':
        return executeRemoveEntity(ctx, cmd);
    default:
        return commandFailed(`Unknown command type: ${(cmd as any).type}`);
    }
}

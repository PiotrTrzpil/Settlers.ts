import { EntityType, EXTENDED_OFFSETS, type Entity } from '../entity';
import {
    BuildingConstructionPhase,
    type BuildingStateManager,
    captureOriginalTerrain,
    setConstructionSiteGroundType,
    applyTerrainLeveling,
} from '../features/building-construction';
import { GameState } from '../game-state';
import { canPlaceBuildingFootprint, isPassable } from '../features/placement';
import { MapSize } from '@/utilities/map-size';
import type { EventBus } from '../event-bus';
import { gameSettings } from '../game-settings';
import { debugStats } from '../debug-stats';
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

    // Immediately capture terrain and change ground to raw earth under the building.
    // This makes the ground visually change right when the building is placed,
    // before the gradual height leveling begins during the TerrainLeveling phase.
    const buildingState = ctx.buildingStateManager.getBuildingState(entity.id)!;
    buildingState.originalTerrain = captureOriginalTerrain(buildingState, groundType, groundHeight, mapSize);
    setConstructionSiteGroundType(buildingState, groundType, mapSize);

    if (gameSettings.state.placeBuildingsCompleted) {
        // Instant mode: level heights immediately, then mark completed
        applyTerrainLeveling(buildingState, groundType, groundHeight, mapSize, 1.0);
        buildingState.terrainModified = true;
        buildingState.phase = BuildingConstructionPhase.Completed;
        buildingState.phaseProgress = 1;
        buildingState.elapsedTime = buildingState.totalDuration;
    }

    // Notify renderer that terrain buffers need re-upload
    ctx.eventBus.emit('terrain:modified', {});

    ctx.eventBus.emit('building:placed', {
        entityId: entity.id,
        buildingType: cmd.buildingType,
        x: cmd.x,
        y: cmd.y,
        player: cmd.player,
    });

    // If placed as completed, emit event (spawning handled by BuildingConstructionSystem listener)
    if (gameSettings.state.placeBuildingsCompleted) {
        ctx.eventBus.emit('building:completed', {
            entityId: entity.id,
            buildingState,
        });
    }

    return commandSuccess([
        { type: 'building_placed', entityId: entity.id, buildingType: cmd.buildingType, x: cmd.x, y: cmd.y },
    ]);
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

/**
 * Check if an entity can be selected, respecting the debug "select all units" setting.
 * Returns true if entity is normally selectable OR if debug mode allows selecting all units.
 */
function canSelectEntity(entity: Entity | undefined): boolean {
    if (!entity) return false;
    if (entity.selectable !== false) return true;
    // Debug mode: allow selecting non-selectable units
    return debugStats.state.selectAllUnits && entity.type === EntityType.Unit;
}

function executeSelect(ctx: CommandContext, cmd: SelectCommand): CommandResult {
    const { state } = ctx;

    if (cmd.entityId !== null) {
        const ent = state.getEntity(cmd.entityId);
        if (ent && !canSelectEntity(ent)) {
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
    const entity = canSelectEntity(rawEntity) ? rawEntity : undefined;

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
    if (!canSelectEntity(entity)) {
        return commandFailed(`Entity ${cmd.entityId} is not selectable`);
    }

    toggleEntityInSelection(state, entity);
    return commandSuccess([{ type: 'selection_changed', selectedIds: [...state.selectedEntityIds] }]);
}

function executeSelectArea(ctx: CommandContext, cmd: SelectAreaCommand): CommandResult {
    const { state } = ctx;
    const allEntities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
    const entities = allEntities.filter(e => canSelectEntity(e));

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

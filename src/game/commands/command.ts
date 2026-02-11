import { EntityType, EXTENDED_OFFSETS, BUILDING_UNIT_TYPE, tileKey } from '../entity';
import { BuildingConstructionPhase } from '../features/building-construction';
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
} from './command-types';

// Re-export Command type and related types for backward compatibility
export type { Command } from './command-types';
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
} from './command-types';

interface CommandContext {
    state: GameState;
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapSize: MapSize;
    eventBus: EventBus;
    /** Optional task system for routing movement through tasks */
    settlerTaskSystem?: SettlerTaskSystem;
}

function executePlaceBuilding(ctx: CommandContext, cmd: PlaceBuildingCommand): boolean {
    const { state, groundType, groundHeight, mapSize } = ctx;

    if (!canPlaceBuildingFootprint(
        groundType, groundHeight, mapSize, state.tileOccupancy,
        cmd.x, cmd.y, cmd.buildingType
    )) {
        return false;
    }

    const entity = state.addEntity(EntityType.Building, cmd.buildingType, cmd.x, cmd.y, cmd.player);

    // If "place as completed" is enabled, immediately mark building as completed
    if (gameSettings.state.placeBuildingsCompleted) {
        const buildingState = state.buildingStateManager.getBuildingState(entity.id);
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
    return true;
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

function executeSpawnUnit(ctx: CommandContext, cmd: SpawnUnitCommand): boolean {
    const { state, groundType, mapSize } = ctx;

    const isTileValid = (x: number, y: number) =>
        x >= 0 && x < mapSize.width && y >= 0 && y < mapSize.height &&
        isPassable(groundType[mapSize.toIndex(x, y)]) &&
        !state.getEntityAt(x, y);

    let spawnX = cmd.x;
    let spawnY = cmd.y;

    if (!isTileValid(spawnX, spawnY)) {
        const found = findValidSpawnTile(cmd.x, cmd.y, isTileValid);
        if (!found) return false;
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

    return true;
}

function findValidSpawnTile(
    x: number, y: number,
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

function executeMoveUnit(ctx: CommandContext, cmd: MoveUnitCommand): boolean {
    // Route through task system if available (handles animation)
    if (ctx.settlerTaskSystem) {
        return ctx.settlerTaskSystem.assignMoveTask(cmd.entityId, cmd.targetX, cmd.targetY);
    }
    // Fallback to direct movement (no animation handling)
    return ctx.state.movement.moveUnit(cmd.entityId, cmd.targetX, cmd.targetY);
}

function executeSelect(ctx: CommandContext, cmd: SelectCommand): boolean {
    const { state } = ctx;

    if (cmd.entityId !== null) {
        const ent = state.getEntity(cmd.entityId);
        if (ent && ent.selectable === false) {
            state.selectedEntityId = null;
            state.selectedEntityIds.clear();
            return true;
        }
    }

    state.selectedEntityId = cmd.entityId;
    state.selectedEntityIds.clear();
    if (cmd.entityId !== null) {
        state.selectedEntityIds.add(cmd.entityId);
    }
    return true;
}

function executeSelectAtTile(ctx: CommandContext, cmd: SelectAtTileCommand): boolean {
    const { state } = ctx;
    const rawEntity = state.getEntityAt(cmd.x, cmd.y);
    const entity = rawEntity?.selectable !== false ? rawEntity : undefined;

    if (cmd.addToSelection) {
        return toggleEntityInSelection(state, entity);
    }

    // Replace selection
    state.selectedEntityIds.clear();
    state.selectedEntityId = entity?.id ?? null;
    if (entity) {
        state.selectedEntityIds.add(entity.id);
    }
    return true;
}

function toggleEntityInSelection(
    state: GameState,
    entity: { id: number } | undefined
): boolean {
    if (!entity) return true;

    if (state.selectedEntityIds.has(entity.id)) {
        state.selectedEntityIds.delete(entity.id);
        if (state.selectedEntityId === entity.id) {
            state.selectedEntityId = state.selectedEntityIds.size > 0
                ? state.selectedEntityIds.values().next().value!
                : null;
        }
    } else {
        state.selectedEntityIds.add(entity.id);
        if (state.selectedEntityId === null) {
            state.selectedEntityId = entity.id;
        }
    }
    return true;
}

function executeToggleSelection(ctx: CommandContext, cmd: ToggleSelectionCommand): boolean {
    const { state } = ctx;
    const entity = state.getEntity(cmd.entityId);
    if (!entity || entity.selectable === false) return false;

    return toggleEntityInSelection(state, entity);
}

function executeSelectArea(ctx: CommandContext, cmd: SelectAreaCommand): boolean {
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
    return true;
}

function executeMoveSelectedUnits(ctx: CommandContext, cmd: MoveSelectedUnitsCommand): boolean {
    const { state, settlerTaskSystem } = ctx;

    const selectedUnits: number[] = [];
    for (const entityId of state.selectedEntityIds) {
        const e = state.getEntity(entityId);
        if (e && e.type === EntityType.Unit) {
            selectedUnits.push(entityId);
        }
    }
    if (selectedUnits.length === 0) return false;

    let anyMoved = false;
    for (let i = 0; i < selectedUnits.length; i++) {
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
        const targetX = cmd.targetX + offset[0];
        const targetY = cmd.targetY + offset[1];

        // Route through task system if available (handles animation)
        const moved = settlerTaskSystem
            ? settlerTaskSystem.assignMoveTask(selectedUnits[i], targetX, targetY)
            : state.movement.moveUnit(selectedUnits[i], targetX, targetY);

        if (moved) {
            anyMoved = true;
        }
    }
    return anyMoved;
}

function executeRemoveEntity(ctx: CommandContext, cmd: RemoveEntityCommand): boolean {
    const { state } = ctx;
    const entity = state.getEntity(cmd.entityId);
    if (!entity) return false;

    if (entity.type === EntityType.Building) {
        const bs = state.buildingStateManager.getBuildingState(cmd.entityId);
        if (bs) {
            ctx.eventBus.emit('building:removed', { entityId: cmd.entityId, buildingState: bs });
        }
    }

    state.removeEntity(cmd.entityId);
    return true;
}

function executePlaceResource(ctx: CommandContext, cmd: PlaceResourceCommand): boolean {
    const { state, mapSize, groundType } = ctx;

    if (cmd.x < 0 || cmd.x >= mapSize.width || cmd.y < 0 || cmd.y >= mapSize.height) {
        return false;
    }

    // Check passability (not sea/rock)
    if (!isPassable(groundType[mapSize.toIndex(cmd.x, cmd.y)])) {
        return false;
    }

    // Check if tile is occupied
    if (state.getEntityAt(cmd.x, cmd.y)) {
        return false;
    }

    // Create a StackedResource entity for the material
    const entity = state.addEntity(EntityType.StackedResource, cmd.materialType, cmd.x, cmd.y, 0);

    // Update quantity in resource state
    const resourceState = state.resourceStates.get(entity.id);
    if (resourceState) {
        resourceState.quantity = cmd.amount;
    }

    return true;
}


/**
 * Execute a player command against the game state.
 * Returns true if the command was successfully executed.
 */
export function executeCommand(
    state: GameState,
    cmd: Command,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    eventBus: EventBus,
    settlerTaskSystem?: SettlerTaskSystem
): boolean {
    const ctx: CommandContext = { state, groundType, groundHeight, mapSize, eventBus, settlerTaskSystem };

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
        return false;
    }
}

import { EntityType, EXTENDED_OFFSETS, tileKey, getUnitLevel } from '../entity';
import {
    BuildingConstructionPhase,
    type BuildingStateManager,
    captureOriginalTerrain,
    setConstructionSiteGroundType,
    applyTerrainLeveling,
} from '../features/building-construction';
import { BUILDING_SPAWN_ON_COMPLETE } from '../features/building-construction/spawn-units';
import { getBuildingWorkerInfo } from '../game-data-access';
import { BuildingType } from '../buildings/types';
import { GameState } from '../game-state';
import { canPlaceBuildingFootprint } from '../features/placement';
import { ringTiles } from '../systems/spatial-search';
import type { TerrainData } from '../terrain';
import type { EventBus } from '../event-bus';
import type { GameSettings } from '../game-settings';
import { debugStats } from '../debug-stats';
import type { SettlerTaskSystem } from '../features/settler-tasks';
import type { TreeSystem } from '../features/trees';
import type { CropSystem } from '../features/crops';
import type { CombatSystem } from '../features/combat';
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
    type SpawnVisualResourceCommand,
    type SpawnBuildingUnitsCommand,
    type PlantTreeCommand,
    type PlantCropCommand,
    type PlantTreesAreaCommand,
    type ScriptAddGoodsCommand,
    type ScriptAddBuildingCommand,
    type ScriptAddSettlersCommand,
    type CommandResult,
    commandSuccess,
    commandFailed,
} from './command-types';

export interface CommandContext {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    /** Game settings (reactive state) — used by placement commands for instant-complete mode */
    settings: GameSettings;
    /** Optional task system for routing movement through tasks */
    settlerTaskSystem?: SettlerTaskSystem;
    /** Building state manager for construction phases */
    buildingStateManager: BuildingStateManager;
    /** Tree system for planting/registration */
    treeSystem?: TreeSystem;
    /** Crop system for planting/registration */
    cropSystem?: CropSystem;
    /** Combat system — used to release units from auto-combat when player issues commands */
    combatSystem?: CombatSystem;
}

function executePlaceBuilding(ctx: CommandContext, cmd: PlaceBuildingCommand): CommandResult {
    const { state, terrain } = ctx;

    if (!canPlaceBuildingFootprint(terrain, state.tileOccupancy, cmd.x, cmd.y, cmd.buildingType, cmd.race)) {
        return commandFailed(`Cannot place building at (${cmd.x}, ${cmd.y}): invalid placement`);
    }

    const entity = state.addEntity(
        EntityType.Building,
        cmd.buildingType,
        cmd.x,
        cmd.y,
        cmd.player,
        undefined,
        undefined,
        cmd.race
    );

    // Immediately capture terrain and change ground to raw earth under the building.
    // This makes the ground visually change right when the building is placed,
    // before the gradual height leveling begins during the TerrainLeveling phase.
    const buildingState = ctx.buildingStateManager.getBuildingState(entity.id);
    if (!buildingState)
        throw new Error(`No building state for entity ${entity.id} after placement (${cmd.buildingType})`);
    const { groundType, groundHeight, mapSize } = terrain;
    buildingState.originalTerrain = captureOriginalTerrain(buildingState, groundType, groundHeight, mapSize);
    setConstructionSiteGroundType(buildingState, groundType, mapSize);

    if (ctx.settings.placeBuildingsCompleted) {
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
    if (ctx.settings.placeBuildingsCompleted) {
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
    const { state, terrain } = ctx;

    const isTileValid = (x: number, y: number) =>
        terrain.isInBounds(x, y) && terrain.isPassable(x, y) && !state.getEntityAt(x, y);

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
    entity.race = cmd.race;
    entity.level = getUnitLevel(cmd.unitType);

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

    // Player command overrides auto-combat — release unit so it obeys
    ctx.combatSystem?.releaseFromCombat(cmd.entityId);

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
    const sel = state.selection;
    const debugAll = debugStats.state.selectAllUnits;

    if (cmd.entityId !== null) {
        const ent = state.getEntity(cmd.entityId);
        if (ent && !sel.canSelect(ent, debugAll)) {
            sel.clear();
            return commandSuccess([{ type: 'selection_changed', selectedIds: [] }]);
        }
    }

    sel.select(cmd.entityId);

    return commandSuccess([{ type: 'selection_changed', selectedIds: cmd.entityId !== null ? [cmd.entityId] : [] }]);
}

function executeSelectAtTile(ctx: CommandContext, cmd: SelectAtTileCommand): CommandResult {
    const { state } = ctx;
    const sel = state.selection;
    const debugAll = debugStats.state.selectAllUnits;
    const rawEntity = state.getEntityAt(cmd.x, cmd.y);
    const entity = sel.canSelect(rawEntity, debugAll) ? rawEntity : undefined;

    if (cmd.addToSelection) {
        if (entity) sel.toggle(entity.id);
        return commandSuccess([{ type: 'selection_changed', selectedIds: [...sel.selectedEntityIds] }]);
    }

    sel.select(entity?.id ?? null);
    return commandSuccess([{ type: 'selection_changed', selectedIds: entity ? [entity.id] : [] }]);
}

function executeToggleSelection(ctx: CommandContext, cmd: ToggleSelectionCommand): CommandResult {
    const { state } = ctx;
    const sel = state.selection;
    const entity = state.getEntity(cmd.entityId);
    if (!sel.canSelect(entity, debugStats.state.selectAllUnits)) {
        return commandFailed(`Entity ${cmd.entityId} is not selectable`);
    }

    sel.toggle(cmd.entityId);
    return commandSuccess([{ type: 'selection_changed', selectedIds: [...sel.selectedEntityIds] }]);
}

function executeSelectArea(ctx: CommandContext, cmd: SelectAreaCommand): CommandResult {
    const { state } = ctx;
    const allEntities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
    const selectedIds = state.selection.selectArea(allEntities, debugStats.state.selectAllUnits);
    return commandSuccess([{ type: 'selection_changed', selectedIds }]);
}

function executeMoveSelectedUnits(ctx: CommandContext, cmd: MoveSelectedUnitsCommand): CommandResult {
    const { state, settlerTaskSystem } = ctx;

    const selectedUnits = state.selection.getSelectedByType(EntityType.Unit);
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
        const unit = selectedUnits[i]!;
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)]!;
        const targetX = cmd.targetX + offset[0];
        const targetY = cmd.targetY + offset[1];

        // Player command overrides auto-combat — release unit so it obeys
        ctx.combatSystem?.releaseFromCombat(unit.id);

        const fromX = unit.x;
        const fromY = unit.y;

        // Route through task system if available (handles animation)
        const moved = settlerTaskSystem
            ? settlerTaskSystem.assignMoveTask(unit.id, targetX, targetY)
            : state.movement.moveUnit(unit.id, targetX, targetY);

        if (moved) {
            effects.push({
                type: 'entity_moved',
                entityId: unit.id,
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
    const { state, terrain } = ctx;

    if (!terrain.isInBounds(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is out of bounds`);
    }

    // Check passability (not sea/rock)
    if (!terrain.isPassable(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is not passable`);
    }

    // Check if tile is occupied
    if (state.getEntityAt(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is already occupied`);
    }

    // Create a StackedResource entity for the material
    const entity = state.addEntity(EntityType.StackedResource, cmd.materialType, cmd.x, cmd.y, 0);

    // Update quantity in resource state
    const resourceState = state.resources.states.get(entity.id);
    if (resourceState) {
        resourceState.quantity = cmd.amount;
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedResource' }]);
}

// === System command handlers ===

function executeSpawnVisualResource(ctx: CommandContext, cmd: SpawnVisualResourceCommand): CommandResult {
    const { state } = ctx;

    const entity = state.addEntity(EntityType.StackedResource, cmd.materialType, cmd.x, cmd.y, cmd.player);

    state.resources.setQuantity(entity.id, cmd.quantity);

    if (cmd.buildingId !== undefined) {
        state.resources.setBuildingId(entity.id, cmd.buildingId);
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedResource' }]);
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- complex game state machine for unit spawning
function executeSpawnBuildingUnits(ctx: CommandContext, cmd: SpawnBuildingUnitsCommand): CommandResult {
    const { state, terrain, eventBus } = ctx;
    const entity = state.getEntityOrThrow(cmd.buildingEntityId, 'completed building for unit spawning');
    const buildingState = ctx.buildingStateManager.getBuildingState(cmd.buildingEntityId);
    if (!buildingState)
        throw new Error(`No building state for completed building ${cmd.buildingEntityId} (executeSpawnBuildingUnits)`);
    const { tileX: bx, tileY: by } = buildingState;
    const effects: { type: 'unit_spawned'; entityId: number; unitType: number; x: number; y: number }[] = [];

    // Spawn units from BUILDING_SPAWN_ON_COMPLETE (carriers from residences, soldiers from barracks)
    const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingState.buildingType];
    if (spawnDef) {
        let spawned = 0;
        for (let radius = 1; radius <= 4 && spawned < spawnDef.count; radius++) {
            for (const tile of ringTiles(bx, by, radius)) {
                if (spawned >= spawnDef.count) break;
                if (!terrain.isInBounds(tile.x, tile.y)) continue;
                if (!terrain.isPassable(tile.x, tile.y)) continue;
                if (state.getEntityAt(tile.x, tile.y)) continue;

                const spawnedEntity = state.addEntity(
                    EntityType.Unit,
                    spawnDef.unitType,
                    tile.x,
                    tile.y,
                    entity.player,
                    spawnDef.selectable
                );
                spawnedEntity.race = entity.race;

                eventBus.emit('unit:spawned', {
                    entityId: spawnedEntity.id,
                    unitType: spawnDef.unitType,
                    x: tile.x,
                    y: tile.y,
                    player: entity.player,
                });

                effects.push({
                    type: 'unit_spawned',
                    entityId: spawnedEntity.id,
                    unitType: spawnDef.unitType,
                    x: tile.x,
                    y: tile.y,
                });
                spawned++;
            }
        }
    }

    // Spawn dedicated worker if placeBuildingsWithWorker is enabled
    // Skip buildings that already spawn units via BUILDING_SPAWN_ON_COMPLETE (residences, barracks)
    if (ctx.settings.placeBuildingsWithWorker && !spawnDef) {
        const workerInfo = getBuildingWorkerInfo(entity.race, buildingState.buildingType);
        if (workerInfo) {
            const workerEntity = state.addEntity(EntityType.Unit, workerInfo.unitType, bx, by, entity.player);
            workerEntity.race = entity.race;

            // Restore building's tile occupancy — workers "work inside" buildings
            state.tileOccupancy.set(tileKey(bx, by), buildingState.entityId);

            eventBus.emit('unit:spawned', {
                entityId: workerEntity.id,
                unitType: workerInfo.unitType,
                x: bx,
                y: by,
                player: entity.player,
            });

            effects.push({
                type: 'unit_spawned',
                entityId: workerEntity.id,
                unitType: workerInfo.unitType,
                x: bx,
                y: by,
            });
        }
    }

    return commandSuccess(effects);
}

function executePlantTree(ctx: CommandContext, cmd: PlantTreeCommand): CommandResult {
    const { state } = ctx;

    // Check tile is still valid — ignore units (the forester stands on the tile while planting)
    const existing = state.getEntityAt(cmd.x, cmd.y);
    if (existing && existing.type !== EntityType.Unit) {
        return commandFailed(`Tile (${cmd.x}, ${cmd.y}) is occupied, cannot plant tree`);
    }

    const entity = state.addEntity(EntityType.MapObject, cmd.treeType, cmd.x, cmd.y, 0);

    // Register with tree system for growth tracking
    if (!ctx.treeSystem) throw new Error(`plant_tree command requires treeSystem in CommandContext`);
    ctx.treeSystem.register(entity.id, cmd.treeType, true);

    return commandSuccess([{ type: 'tree_planted', entityId: entity.id, treeType: cmd.treeType, x: cmd.x, y: cmd.y }]);
}

function executePlantTreesArea(ctx: CommandContext, cmd: PlantTreesAreaCommand): CommandResult {
    if (!ctx.treeSystem) throw new Error(`plant_trees_area command requires treeSystem in CommandContext`);
    const planted = ctx.treeSystem.plantTreesNear(cmd.centerX, cmd.centerY, cmd.count, cmd.radius);
    if (planted === 0) {
        return commandFailed(`Could not plant any trees near (${cmd.centerX}, ${cmd.centerY})`);
    }
    return commandSuccess([{ type: 'entity_created', entityId: 0, entityType: `${planted} trees planted` }]);
}

function executePlantCrop(ctx: CommandContext, cmd: PlantCropCommand): CommandResult {
    const { state } = ctx;

    // Check tile is still valid — ignore units (the farmer stands on the tile while planting)
    const existing = state.getEntityAt(cmd.x, cmd.y);
    if (existing && existing.type !== EntityType.Unit) {
        return commandFailed(`Tile (${cmd.x}, ${cmd.y}) is occupied, cannot plant crop`);
    }

    const entity = state.addEntity(EntityType.MapObject, cmd.cropType, cmd.x, cmd.y, 0);

    // Register with crop system for growth tracking (planted=true → Growing stage)
    if (!ctx.cropSystem) throw new Error(`plant_crop command requires cropSystem in CommandContext`);
    ctx.cropSystem.register(entity.id, cmd.cropType, true);

    return commandSuccess([{ type: 'crop_planted', entityId: entity.id, cropType: cmd.cropType, x: cmd.x, y: cmd.y }]);
}

// === Script command handlers ===

function executeScriptAddGoods(ctx: CommandContext, cmd: ScriptAddGoodsCommand): CommandResult {
    const { state } = ctx;

    const entity = state.addEntity(EntityType.StackedResource, cmd.materialType, cmd.x, cmd.y, 0);

    if (cmd.amount > 1) {
        state.resources.setQuantity(entity.id, cmd.amount);
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedResource' }]);
}

function executeScriptAddBuilding(ctx: CommandContext, cmd: ScriptAddBuildingCommand): CommandResult {
    const { state } = ctx;

    const entity = state.addEntity(
        EntityType.Building,
        cmd.buildingType,
        cmd.x,
        cmd.y,
        cmd.player,
        undefined,
        undefined,
        cmd.race
    );

    return commandSuccess([
        {
            type: 'building_placed',
            entityId: entity.id,
            buildingType: cmd.buildingType as BuildingType,
            x: cmd.x,
            y: cmd.y,
        },
    ]);
}

function executeScriptAddSettlers(ctx: CommandContext, cmd: ScriptAddSettlersCommand): CommandResult {
    const { state, eventBus } = ctx;
    const effects: { type: 'unit_spawned'; entityId: number; unitType: number; x: number; y: number }[] = [];

    for (let i = 0; i < cmd.amount; i++) {
        const offsetX = cmd.x + (i % 3);
        const offsetY = cmd.y + Math.floor(i / 3);

        const entity = state.addEntity(EntityType.Unit, cmd.unitType, offsetX, offsetY, cmd.player);
        entity.race = cmd.race;

        eventBus.emit('unit:spawned', {
            entityId: entity.id,
            unitType: cmd.unitType,
            x: offsetX,
            y: offsetY,
            player: cmd.player,
        });

        effects.push({
            type: 'unit_spawned',
            entityId: entity.id,
            unitType: cmd.unitType,
            x: offsetX,
            y: offsetY,
        });
    }

    return commandSuccess(effects);
}

// Each handler takes a specific Command subtype, but the map stores them generically.
// cmd is typed `any` intentionally: each handler is matched to its Command subtype at
// runtime via the COMMAND_HANDLERS map, so variance errors would be false positives.
type CommandHandler = (ctx: CommandContext, cmd: any) => CommandResult;

/** Map of command type -> handler function. Keeps executeCommand under complexity limit. */
const COMMAND_HANDLERS: Record<Command['type'], CommandHandler> = {
    place_building: executePlaceBuilding,
    place_resource: executePlaceResource,
    spawn_unit: executeSpawnUnit,
    move_unit: executeMoveUnit,
    select: executeSelect,
    select_at_tile: executeSelectAtTile,
    toggle_selection: executeToggleSelection,
    select_area: executeSelectArea,
    move_selected_units: executeMoveSelectedUnits,
    remove_entity: executeRemoveEntity,
    spawn_visual_resource: executeSpawnVisualResource,
    spawn_building_units: executeSpawnBuildingUnits,
    plant_tree: executePlantTree,
    plant_crop: executePlantCrop,
    plant_trees_area: executePlantTreesArea,
    script_add_goods: executeScriptAddGoods,
    script_add_building: executeScriptAddBuilding,
    script_add_settlers: executeScriptAddSettlers,
};

/**
 * Execute a command against the game state.
 * Returns a CommandResult with success status, error details, and effects.
 */
export function executeCommand(ctx: CommandContext, cmd: Command): CommandResult {
    const handler = COMMAND_HANDLERS[cmd.type];
    return handler(ctx, cmd);
}

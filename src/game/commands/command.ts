import { EntityType, UnitType, EXTENDED_OFFSETS, tileKey, getUnitLevel, type Entity } from '../entity';
import {
    type ConstructionSiteManager,
    captureOriginalTerrain,
    setConstructionSiteGroundType,
    applyTerrainLeveling,
} from '../features/building-construction';
import {
    BUILDING_SPAWN_ON_COMPLETE,
    RESIDENCE_CONSTRUCTION_WORKER_SPAWNS,
} from '../features/building-construction/spawn-units';
import { getBuildingWorkerInfo, getBuildingDoorPos } from '../game-data-access';
import { BuildingType } from '../buildings/types';
import { GameState } from '../game-state';
import { canPlaceBuildingFootprint } from '../features/placement';
import type { PlacementFilter } from '../features/placement';
import { ringTiles } from '../systems/spatial-search';
import type { TerrainData } from '../terrain';
import type { EventBus } from '../event-bus';
import type { GameSettings } from '../game-settings';
import { debugStats } from '../debug-stats';
import type { SettlerTaskSystem } from '../features/settler-tasks';
import type { TreeSystem } from '../features/trees';
import type { CropSystem } from '../features/crops';
import type { CombatSystem } from '../features/combat';
import type { ProductionControlManager } from '../features/production-control';
import {
    Command,
    FORMATION_OFFSETS,
    PlaceBuildingCommand,
    PlacePileCommand,
    SpawnUnitCommand,
    MoveUnitCommand,
    SelectCommand,
    SelectAtTileCommand,
    ToggleSelectionCommand,
    SelectAreaCommand,
    MoveSelectedUnitsCommand,
    RemoveEntityCommand,
    type SpawnPileCommand,
    type SpawnMapObjectCommand,
    type UpdatePileQuantityCommand,
    type SetStorageFilterCommand,
    type SpawnBuildingUnitsCommand,
    type PlantTreeCommand,
    type PlantCropCommand,
    type PlantTreesAreaCommand,
    type ScriptAddGoodsCommand,
    type ScriptAddBuildingCommand,
    type ScriptAddSettlersCommand,
    type SetProductionModeCommand,
    type SetRecipeProportionCommand,
    type AddToProductionQueueCommand,
    type RemoveFromProductionQueueCommand,
    type CommandResult,
    commandSuccess,
    commandFailed,
    COMMAND_OK,
} from './command-types';
import type { StorageFilterManager } from '../features/inventory/storage-filter-manager';

export interface CommandContext {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    /** Game settings (reactive state) — used by placement commands for instant-complete mode */
    settings: GameSettings;
    /** Task system for routing movement through settler tasks and handling animation */
    settlerTaskSystem: SettlerTaskSystem;
    /** Construction site manager for checking construction status */
    constructionSiteManager: ConstructionSiteManager;
    /** Tree system for planting/registration */
    treeSystem: TreeSystem;
    /** Crop system for planting/registration */
    cropSystem: CropSystem;
    /** Combat system — used to release units from auto-combat when player issues commands */
    combatSystem: CombatSystem;
    /** Production control manager for multi-recipe buildings */
    productionControlManager: ProductionControlManager;
    /** Storage filter manager for controlling which materials a storage accepts */
    storageFilterManager: StorageFilterManager;
    /** Optional placement filter for territory/policy enforcement */
    placementFilter: PlacementFilter | null;
}

function executePlaceBuilding(ctx: CommandContext, cmd: PlaceBuildingCommand): CommandResult {
    const { state, terrain } = ctx;

    if (
        !cmd.trusted &&
        !canPlaceBuildingFootprint(
            terrain,
            state.tileOccupancy,
            cmd.x,
            cmd.y,
            cmd.buildingType,
            cmd.race,
            state.buildingFootprint,
            ctx.placementFilter,
            cmd.player
        )
    ) {
        return commandFailed(`Cannot place building at (${cmd.x}, ${cmd.y}): invalid placement`);
    }

    const entity = state.addBuilding(cmd.buildingType, cmd.x, cmd.y, cmd.player, cmd.race);

    // Immediately capture terrain and change ground to raw earth under the building.
    // This makes the ground visually change right when the building is placed,
    // before the gradual height leveling begins during the TerrainLeveling phase.
    const terrainParams = { buildingType: cmd.buildingType, race: cmd.race, tileX: cmd.x, tileY: cmd.y };
    const { groundType, groundHeight, mapSize } = terrain;
    const originalTerrain = captureOriginalTerrain(terrainParams, groundType, groundHeight, mapSize);
    setConstructionSiteGroundType(terrainParams, groundType, mapSize, originalTerrain);

    if (cmd.completed) {
        // Instant mode: level heights immediately before emitting building:placed
        applyTerrainLeveling(terrainParams, groundType, groundHeight, mapSize, 1.0, originalTerrain);
    } else {
        // Construction site: footprint should be walkable during leveling phase.
        // Re-added to buildingOccupancy when leveling completes (construction:levelingComplete).
        state.clearBuildingFootprintBlock(entity.id);
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

    // Store captured originalTerrain on the construction site (created by building:placed handler).
    // Must happen after event emission so the site exists.
    const site = ctx.constructionSiteManager.getSite(entity.id);
    if (site) site.terrain.originalTerrain = originalTerrain;

    // If placed as completed, emit event (spawning handled by BuildingConstructionSystem listener)
    if (cmd.completed) {
        ctx.eventBus.emit('building:completed', {
            entityId: entity.id,
            buildingType: cmd.buildingType,
            race: cmd.race,
            placedCompleted: true,
            spawnWorker: cmd.spawnWorker,
        });
    }

    // Worker spawning is handled by building:completed → spawn_building_units command.
    // executePlaceBuilding does NOT spawn workers itself to avoid double-spawning.
    const effects: any[] = [
        { type: 'building_placed', entityId: entity.id, buildingType: cmd.buildingType, x: cmd.x, y: cmd.y },
    ];

    return commandSuccess(effects);
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

    const entity = state.addUnit(cmd.unitType, spawnX, spawnY, cmd.player, cmd.race);
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
    ctx.combatSystem.releaseFromCombat(cmd.entityId);

    const fromX = entity.x;
    const fromY = entity.y;

    // Route through task system (handles animation and interrupts current job)
    const success = ctx.settlerTaskSystem.assignMoveTask(cmd.entityId, cmd.targetX, cmd.targetY);

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
    const { state } = ctx;

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
        ctx.combatSystem.releaseFromCombat(unit.id);

        const fromX = unit.x;
        const fromY = unit.y;

        // Route through task system (handles animation and interrupts current job)
        const moved = ctx.settlerTaskSystem.assignMoveTask(unit.id, targetX, targetY);

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
        ctx.eventBus.emit('building:removed', {
            entityId: cmd.entityId,
            buildingType: entity.subType as BuildingType,
        });
    }

    state.removeEntity(cmd.entityId);
    return commandSuccess([{ type: 'entity_removed', entityId: cmd.entityId }]);
}

function executePlacePile(ctx: CommandContext, cmd: PlacePileCommand): CommandResult {
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

    // Create a StackedPile entity for the material
    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd.x, cmd.y, 0);

    // Update quantity in resource state
    const resourceState = state.piles.states.get(entity.id);
    if (resourceState) {
        resourceState.quantity = cmd.amount;
    }

    // Free piles participate in logistics as output-only sources
    ctx.eventBus.emit('pile:freePilePlaced', {
        entityId: entity.id,
        materialType: cmd.materialType,
        quantity: cmd.amount,
    });

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedPile' }]);
}

// === System command handlers ===

function executeSpawnMapObject(_ctx: CommandContext, cmd: SpawnMapObjectCommand): CommandResult {
    const entity = _ctx.state.addEntity(
        EntityType.MapObject,
        cmd.objectType,
        cmd.x,
        cmd.y,
        0,
        undefined,
        cmd.variation
    );
    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'MapObject' }]);
}

function executeSpawnPile(ctx: CommandContext, cmd: SpawnPileCommand): CommandResult {
    const { state, terrain } = ctx;
    if (!terrain.isInBounds(cmd.x, cmd.y)) {
        throw new Error(`spawn_pile: position (${cmd.x}, ${cmd.y}) out of bounds`);
    }
    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd.x, cmd.y, cmd.player);
    // onEntityCreated already called createState(entity.id) with default { kind: 'free' }
    state.piles.setKind(entity.id, cmd.kind);
    state.piles.setQuantity(entity.id, cmd.quantity);

    // Free piles participate in logistics as output-only sources
    if (cmd.kind.kind === 'free') {
        ctx.eventBus.emit('pile:freePilePlaced', {
            entityId: entity.id,
            materialType: cmd.materialType,
            quantity: cmd.quantity,
        });
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedPile' }]);
}

function executeUpdatePileQuantity(ctx: CommandContext, cmd: UpdatePileQuantityCommand): CommandResult {
    ctx.state.piles.setQuantity(cmd.entityId, cmd.quantity);
    return COMMAND_OK;
}

function executeSetStorageFilter(ctx: CommandContext, cmd: SetStorageFilterCommand): CommandResult {
    const building = ctx.state.getEntityOrThrow(cmd.buildingId, 'set_storage_filter');
    if ((building.subType as BuildingType) !== BuildingType.StorageArea) {
        return commandFailed(`set_storage_filter: building ${cmd.buildingId} is not a StorageArea`);
    }
    if (cmd.allowed) {
        ctx.storageFilterManager.allow(cmd.buildingId, cmd.material);
    } else {
        ctx.storageFilterManager.disallow(cmd.buildingId, cmd.material);
    }
    return COMMAND_OK;
}

type UnitSpawnEffect = { type: 'unit_spawned'; entityId: number; unitType: number; x: number; y: number };

/** Spawn the building's dedicated worker at its door tile, if not already present. */
function spawnWorkerAtDoor(
    ctx: CommandContext,
    entity: Entity,
    bx: number,
    by: number,
    effects: UnitSpawnEffect[]
): void {
    const { state, eventBus } = ctx;
    const buildingType = entity.subType as BuildingType;
    const workerInfo = getBuildingWorkerInfo(entity.race, buildingType);
    if (!workerInfo) return;
    const door = getBuildingDoorPos(bx, by, entity.race, buildingType);
    const existingAtDoor = state.getEntityAt(door.x, door.y);
    if (existingAtDoor && existingAtDoor.type === EntityType.Unit) return;
    const doorKey = tileKey(door.x, door.y);
    const previousOwner = state.tileOccupancy.get(doorKey);
    const workerEntity = state.addUnit(workerInfo.unitType, door.x, door.y, entity.player, entity.race);
    if (previousOwner === entity.id) {
        state.tileOccupancy.set(doorKey, entity.id);
    }
    eventBus.emit('unit:spawned', {
        entityId: workerEntity.id,
        unitType: workerInfo.unitType,
        x: door.x,
        y: door.y,
        player: entity.player,
    });
    effects.push({
        type: 'unit_spawned',
        entityId: workerEntity.id,
        unitType: workerInfo.unitType,
        x: door.x,
        y: door.y,
    });
}

/** Check if a tile is a valid spawn location. */
function isSpawnableTile(ctx: CommandContext, x: number, y: number): boolean {
    return ctx.terrain.isInBounds(x, y) && ctx.terrain.isPassable(x, y) && !ctx.state.getEntityAt(x, y);
}

/** Spawn `count` units of `unitType` near tile (bx, by), recording effects. */
function spawnUnitsNear(
    ctx: CommandContext,
    bx: number,
    by: number,
    unitType: number,
    count: number,
    player: number,
    race: number,
    selectable: boolean | undefined,
    effects: UnitSpawnEffect[]
): void {
    const { state, eventBus } = ctx;
    let spawned = 0;
    for (let radius = 1; radius <= 4 && spawned < count; radius++) {
        for (const tile of ringTiles(bx, by, radius)) {
            if (spawned >= count) break;
            if (!isSpawnableTile(ctx, tile.x, tile.y)) continue;

            const spawnedEntity = state.addUnit(unitType, tile.x, tile.y, player, race, selectable);

            eventBus.emit('unit:spawned', {
                entityId: spawnedEntity.id,
                unitType: unitType as UnitType,
                x: tile.x,
                y: tile.y,
                player,
            });

            effects.push({ type: 'unit_spawned', entityId: spawnedEntity.id, unitType, x: tile.x, y: tile.y });
            spawned++;
        }
    }
}

function executeSpawnBuildingUnits(ctx: CommandContext, cmd: SpawnBuildingUnitsCommand): CommandResult {
    const entity = ctx.state.getEntityOrThrow(cmd.buildingEntityId, 'completed building for unit spawning');
    const buildingType = entity.subType as BuildingType;
    const bx = entity.x;
    const by = entity.y;
    const effects: UnitSpawnEffect[] = [];

    // Spawn units from BUILDING_SPAWN_ON_COMPLETE (immediate-only, i.e. no spawnInterval).
    // Residences use interval-based spawning via ResidenceSpawnerSystem instead.
    const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingType];
    if (spawnDef && !spawnDef.spawnInterval) {
        spawnUnitsNear(
            ctx,
            bx,
            by,
            spawnDef.unitType,
            spawnDef.count,
            entity.player,
            entity.race,
            spawnDef.selectable,
            effects
        );
    }

    // Spawn construction workers (builders/diggers) from residences on completion.
    // These are roaming workers that self-assign to construction sites via the task system.
    // Skip when buildings are instantly completed (no construction sites to work on).
    const workerSpawns = RESIDENCE_CONSTRUCTION_WORKER_SPAWNS[buildingType];
    if (workerSpawns && !cmd.placedCompleted) {
        for (const workerDef of workerSpawns) {
            spawnUnitsNear(
                ctx,
                bx,
                by,
                workerDef.unitType,
                workerDef.count,
                entity.player,
                entity.race,
                workerDef.selectable,
                effects
            );
        }
    }

    // Spawn dedicated worker when requested by the command.
    // Skip buildings that already spawn units via BUILDING_SPAWN_ON_COMPLETE (residences, barracks).
    // Skip if a unit already exists at the door (placed by executePlaceBuilding's spawnWorker).
    if (cmd.spawnWorker && !spawnDef) {
        spawnWorkerAtDoor(ctx, entity, bx, by, effects);
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
    ctx.treeSystem.register(entity.id, cmd.treeType, true);
    ctx.eventBus.emit('tree:planted', { entityId: entity.id, treeType: cmd.treeType, x: cmd.x, y: cmd.y });

    return commandSuccess([{ type: 'tree_planted', entityId: entity.id, treeType: cmd.treeType, x: cmd.x, y: cmd.y }]);
}

function executePlantTreesArea(ctx: CommandContext, cmd: PlantTreesAreaCommand): CommandResult {
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
    ctx.cropSystem.register(entity.id, cmd.cropType, true);

    ctx.eventBus.emit('crop:planted', { entityId: entity.id, cropType: cmd.cropType, x: cmd.x, y: cmd.y });

    return commandSuccess([{ type: 'crop_planted', entityId: entity.id, cropType: cmd.cropType, x: cmd.x, y: cmd.y }]);
}

// === Script command handlers ===

function executeScriptAddGoods(ctx: CommandContext, cmd: ScriptAddGoodsCommand): CommandResult {
    const { state } = ctx;

    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd.x, cmd.y, 0);

    if (cmd.amount > 1) {
        state.piles.setQuantity(entity.id, cmd.amount);
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedPile' }]);
}

function executeScriptAddBuilding(ctx: CommandContext, cmd: ScriptAddBuildingCommand): CommandResult {
    const { state } = ctx;

    const entity = state.addBuilding(cmd.buildingType, cmd.x, cmd.y, cmd.player, cmd.race);

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

        const entity = state.addUnit(cmd.unitType, offsetX, offsetY, cmd.player, cmd.race);

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

// === Production control command handlers ===

function executeSetProductionMode(ctx: CommandContext, cmd: SetProductionModeCommand): CommandResult {
    const state = ctx.productionControlManager.getProductionState(cmd.buildingId);
    if (!state) {
        return commandFailed(`Building ${cmd.buildingId} has no production control state`);
    }
    ctx.productionControlManager.setMode(cmd.buildingId, cmd.mode);
    return { success: true };
}

function executeSetRecipeProportion(ctx: CommandContext, cmd: SetRecipeProportionCommand): CommandResult {
    ctx.productionControlManager.setProportion(cmd.buildingId, cmd.recipeIndex, cmd.weight);
    return { success: true };
}

function executeAddToProductionQueue(ctx: CommandContext, cmd: AddToProductionQueueCommand): CommandResult {
    ctx.productionControlManager.addToQueue(cmd.buildingId, cmd.recipeIndex);
    return { success: true };
}

function executeRemoveFromProductionQueue(ctx: CommandContext, cmd: RemoveFromProductionQueueCommand): CommandResult {
    ctx.productionControlManager.removeFromQueue(cmd.buildingId, cmd.recipeIndex);
    return { success: true };
}

// Each handler takes a specific Command subtype, but the map stores them generically.
// cmd is typed `any` intentionally: each handler is matched to its Command subtype at
// runtime via the COMMAND_HANDLERS map, so variance errors would be false positives.
type CommandHandler = (ctx: CommandContext, cmd: any) => CommandResult;

/** Map of command type -> handler function. Keeps executeCommand under complexity limit. */
const COMMAND_HANDLERS: Record<Command['type'], CommandHandler> = {
    place_building: executePlaceBuilding,
    place_pile: executePlacePile,
    spawn_unit: executeSpawnUnit,
    move_unit: executeMoveUnit,
    select: executeSelect,
    select_at_tile: executeSelectAtTile,
    toggle_selection: executeToggleSelection,
    select_area: executeSelectArea,
    move_selected_units: executeMoveSelectedUnits,
    remove_entity: executeRemoveEntity,
    spawn_map_object: executeSpawnMapObject,
    spawn_pile: executeSpawnPile,
    update_pile_quantity: executeUpdatePileQuantity,
    set_storage_filter: executeSetStorageFilter,
    spawn_building_units: executeSpawnBuildingUnits,
    plant_tree: executePlantTree,
    plant_crop: executePlantCrop,
    plant_trees_area: executePlantTreesArea,
    script_add_goods: executeScriptAddGoods,
    script_add_building: executeScriptAddBuilding,
    script_add_settlers: executeScriptAddSettlers,
    set_production_mode: executeSetProductionMode,
    set_recipe_proportion: executeSetRecipeProportion,
    add_to_production_queue: executeAddToProductionQueue,
    remove_from_production_queue: executeRemoveFromProductionQueue,
};

/**
 * Execute a command against the game state.
 * Returns a CommandResult with success status, error details, and effects.
 */
export function executeCommand(ctx: CommandContext, cmd: Command): CommandResult {
    const handler = COMMAND_HANDLERS[cmd.type];
    return handler(ctx, cmd);
}

import { EntityType, type Tile } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import { BuildingType, isStorageBuilding } from '../../buildings/types';
import { EMaterialType } from '../../economy';
import type { TreeSystem } from '../../features/trees';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import { SlotKind } from '../../core/pile-kind';
import type {
    PlacePileCommand,
    SpawnPileCommand,
    SpawnMapObjectCommand,
    SetStorageFilterCommand,
    PlantTreeCommand,
    PlantCropCommand,
    PlantTreesAreaCommand,
    CommandResult,
    CommandFailure,
    SpawnResult,
    BatchSpawnResult,
} from '../command-types';
import { commandFailed, COMMAND_OK } from '../command-types';

export interface PlacePileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    getOwner: (tile: Tile) => number;
}

export interface SpawnPileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface SpawnMapObjectDeps {
    state: GameState;
}

export interface SetStorageFilterDeps {
    state: GameState;
    eventBus: EventBus;
    storageFilterManager: StorageFilterManager;
    inventoryManager: BuildingInventoryManager;
}

export interface PlantTreeDeps {
    state: GameState;
    eventBus: EventBus;
}

export interface PlantTreesAreaDeps {
    treeSystem: TreeSystem;
}

export interface PlantCropDeps {
    state: GameState;
    eventBus: EventBus;
}

export function executePlacePile(deps: PlacePileDeps, cmd: PlacePileCommand): SpawnResult | CommandFailure {
    const { state, terrain } = deps;

    if (!terrain.isInBounds(cmd)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is out of bounds`);
    }

    if (!terrain.isPassable(cmd)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is not passable`);
    }

    if (state.getGroundEntityAt(cmd)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is already occupied`);
    }

    const owner = Math.max(0, deps.getOwner(cmd));
    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd, owner);

    deps.eventBus.emit('pile:freePilePlaced', {
        entityId: entity.id,
        materialType: cmd.materialType,
        quantity: cmd.amount,
    });

    return { success: true, entityId: entity.id };
}

export function executeSpawnMapObject(deps: SpawnMapObjectDeps, cmd: SpawnMapObjectCommand): SpawnResult {
    const entity = deps.state.addEntity(EntityType.MapObject, cmd.objectType, cmd, 0, {
        variation: cmd.variation,
    });
    return { success: true, entityId: entity.id };
}

export function executeSpawnPile(deps: SpawnPileDeps, cmd: SpawnPileCommand): SpawnResult {
    const { state, terrain } = deps;
    if (!terrain.isInBounds(cmd)) {
        throw new Error(`spawn_pile: position (${cmd.x}, ${cmd.y}) out of bounds`);
    }

    const existing = state.getGroundEntityAt(cmd);
    if (existing && existing.type === EntityType.StackedPile) {
        throw new Error(
            `spawn_pile: tile (${cmd.x}, ${cmd.y}) already occupied by StackedPile #${existing.id}` +
                ` (${existing.subType}). Caller must find a free tile before spawning.`
        );
    }

    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd, cmd.player);

    if (cmd.kind.kind === 'free') {
        deps.eventBus.emit('pile:freePilePlaced', {
            entityId: entity.id,
            materialType: cmd.materialType,
            quantity: cmd.quantity,
        });
    }

    return { success: true, entityId: entity.id };
}

export function executeSetStorageFilter(deps: SetStorageFilterDeps, cmd: SetStorageFilterCommand): CommandResult {
    const building = deps.state.getEntityOrThrow(cmd.buildingId, 'set_storage_filter');
    if (!isStorageBuilding(building.subType as BuildingType)) {
        return commandFailed(`set_storage_filter: building ${cmd.buildingId} is not a StorageArea`);
    }
    if (cmd.direction !== null) {
        deps.storageFilterManager.setDirection(cmd.buildingId, cmd.material, cmd.direction);
    } else {
        deps.storageFilterManager.disallow(cmd.buildingId, cmd.material);
        // Release empty storage slots so they can be reused by other materials
        const slots = deps.inventoryManager.getSlots(cmd.buildingId);
        for (const slot of slots) {
            if (slot.kind === SlotKind.Storage && slot.materialType === cmd.material && slot.currentAmount === 0) {
                deps.inventoryManager.setSlotMaterial(slot.id, EMaterialType.NO_MATERIAL);
            }
        }
    }
    deps.eventBus.emit('storage:directionChanged', { buildingId: cmd.buildingId, materialType: cmd.material });
    return COMMAND_OK;
}

export function executePlantTree(deps: PlantTreeDeps, cmd: PlantTreeCommand): SpawnResult | CommandFailure {
    const { state } = deps;

    if (state.getGroundEntityAt(cmd)) {
        return commandFailed(`Tile (${cmd.x}, ${cmd.y}) is occupied, cannot plant tree`);
    }

    const entity = state.addEntity(EntityType.MapObject, cmd.treeType, cmd, 0, { planted: true });
    deps.eventBus.emit('tree:planted', { entityId: entity.id, treeType: cmd.treeType, x: cmd.x, y: cmd.y });

    return { success: true, entityId: entity.id };
}

export function executePlantTreesArea(
    deps: PlantTreesAreaDeps,
    cmd: PlantTreesAreaCommand
): BatchSpawnResult | CommandFailure {
    const planted = deps.treeSystem.plantTreesNear({ x: cmd.centerX, y: cmd.centerY }, cmd.count, cmd.radius);
    if (planted === 0) {
        return commandFailed(`Could not plant any trees near (${cmd.centerX}, ${cmd.centerY})`);
    }
    return { success: true, count: planted };
}

export function executePlantCrop(deps: PlantCropDeps, cmd: PlantCropCommand): SpawnResult | CommandFailure {
    const { state } = deps;

    if (state.getGroundEntityAt(cmd)) {
        return commandFailed(`Tile (${cmd.x}, ${cmd.y}) is occupied, cannot plant crop`);
    }

    const entity = state.addEntity(EntityType.MapObject, cmd.cropType, cmd, 0, { planted: true });
    deps.eventBus.emit('crop:planted', { entityId: entity.id, cropType: cmd.cropType, x: cmd.x, y: cmd.y });

    return { success: true, entityId: entity.id };
}

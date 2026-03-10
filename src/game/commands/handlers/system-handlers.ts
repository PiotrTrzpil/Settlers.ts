import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import { BuildingType } from '../../buildings/types';
import type { TreeSystem } from '../../features/trees';
import type { CropSystem } from '../../features/crops';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import type {
    PlacePileCommand,
    SpawnPileCommand,
    SpawnMapObjectCommand,
    UpdatePileQuantityCommand,
    SetStorageFilterCommand,
    PlantTreeCommand,
    PlantCropCommand,
    PlantTreesAreaCommand,
    CommandResult,
} from '../command-types';
import { commandSuccess, commandFailed, COMMAND_OK } from '../command-types';

export interface PlacePileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface SpawnPileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface SpawnMapObjectDeps {
    state: GameState;
}

export interface UpdatePileQuantityDeps {
    state: GameState;
}

export interface SetStorageFilterDeps {
    state: GameState;
    storageFilterManager: StorageFilterManager;
}

export interface PlantTreeDeps {
    state: GameState;
    eventBus: EventBus;
    treeSystem: TreeSystem;
}

export interface PlantTreesAreaDeps {
    treeSystem: TreeSystem;
}

export interface PlantCropDeps {
    state: GameState;
    eventBus: EventBus;
    cropSystem: CropSystem;
}

export function executePlacePile(deps: PlacePileDeps, cmd: PlacePileCommand): CommandResult {
    const { state, terrain } = deps;

    if (!terrain.isInBounds(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is out of bounds`);
    }

    if (!terrain.isPassable(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is not passable`);
    }

    if (state.getEntityAt(cmd.x, cmd.y)) {
        return commandFailed(`Position (${cmd.x}, ${cmd.y}) is already occupied`);
    }

    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd.x, cmd.y, 0);

    const resourceState = state.piles.states.get(entity.id);
    if (resourceState) {
        resourceState.quantity = cmd.amount;
    }

    deps.eventBus.emit('pile:freePilePlaced', {
        entityId: entity.id,
        materialType: cmd.materialType,
        quantity: cmd.amount,
    });

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedPile' }]);
}

export function executeSpawnMapObject(deps: SpawnMapObjectDeps, cmd: SpawnMapObjectCommand): CommandResult {
    const entity = deps.state.addEntity(EntityType.MapObject, cmd.objectType, cmd.x, cmd.y, 0, {
        variation: cmd.variation,
    });
    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'MapObject' }]);
}

export function executeSpawnPile(deps: SpawnPileDeps, cmd: SpawnPileCommand): CommandResult {
    const { state, terrain } = deps;
    if (!terrain.isInBounds(cmd.x, cmd.y)) {
        throw new Error(`spawn_pile: position (${cmd.x}, ${cmd.y}) out of bounds`);
    }
    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd.x, cmd.y, cmd.player);
    state.piles.setKind(entity.id, cmd.kind);
    state.piles.setQuantity(entity.id, cmd.quantity);

    if (cmd.kind.kind === 'free') {
        deps.eventBus.emit('pile:freePilePlaced', {
            entityId: entity.id,
            materialType: cmd.materialType,
            quantity: cmd.quantity,
        });
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedPile' }]);
}

export function executeUpdatePileQuantity(deps: UpdatePileQuantityDeps, cmd: UpdatePileQuantityCommand): CommandResult {
    deps.state.piles.setQuantity(cmd.entityId, cmd.quantity);
    return COMMAND_OK;
}

export function executeSetStorageFilter(deps: SetStorageFilterDeps, cmd: SetStorageFilterCommand): CommandResult {
    const building = deps.state.getEntityOrThrow(cmd.buildingId, 'set_storage_filter');
    if ((building.subType as BuildingType) !== BuildingType.StorageArea) {
        return commandFailed(`set_storage_filter: building ${cmd.buildingId} is not a StorageArea`);
    }
    if (cmd.allowed) {
        deps.storageFilterManager.allow(cmd.buildingId, cmd.material);
    } else {
        deps.storageFilterManager.disallow(cmd.buildingId, cmd.material);
    }
    return COMMAND_OK;
}

export function executePlantTree(deps: PlantTreeDeps, cmd: PlantTreeCommand): CommandResult {
    const { state } = deps;

    const existing = state.getEntityAt(cmd.x, cmd.y);
    if (existing && existing.type !== EntityType.Unit) {
        return commandFailed(`Tile (${cmd.x}, ${cmd.y}) is occupied, cannot plant tree`);
    }

    const entity = state.addEntity(EntityType.MapObject, cmd.treeType, cmd.x, cmd.y, 0);

    deps.treeSystem.register(entity.id, cmd.treeType, true);
    deps.eventBus.emit('tree:planted', { entityId: entity.id, treeType: cmd.treeType, x: cmd.x, y: cmd.y });

    return commandSuccess([{ type: 'tree_planted', entityId: entity.id, treeType: cmd.treeType, x: cmd.x, y: cmd.y }]);
}

export function executePlantTreesArea(deps: PlantTreesAreaDeps, cmd: PlantTreesAreaCommand): CommandResult {
    const planted = deps.treeSystem.plantTreesNear(cmd.centerX, cmd.centerY, cmd.count, cmd.radius);
    if (planted === 0) {
        return commandFailed(`Could not plant any trees near (${cmd.centerX}, ${cmd.centerY})`);
    }
    return commandSuccess([{ type: 'entity_created', entityId: 0, entityType: `${planted} trees planted` }]);
}

export function executePlantCrop(deps: PlantCropDeps, cmd: PlantCropCommand): CommandResult {
    const { state } = deps;

    const existing = state.getEntityAt(cmd.x, cmd.y);
    if (existing && existing.type !== EntityType.Unit) {
        return commandFailed(`Tile (${cmd.x}, ${cmd.y}) is occupied, cannot plant crop`);
    }

    const entity = state.addEntity(EntityType.MapObject, cmd.cropType, cmd.x, cmd.y, 0);

    deps.cropSystem.register(entity.id, cmd.cropType, true);

    deps.eventBus.emit('crop:planted', { entityId: entity.id, cropType: cmd.cropType, x: cmd.x, y: cmd.y });

    return commandSuccess([{ type: 'crop_planted', entityId: entity.id, cropType: cmd.cropType, x: cmd.x, y: cmd.y }]);
}

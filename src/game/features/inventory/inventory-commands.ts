/**
 * Inventory-domain command handlers: storage filters and free pile placement.
 * Registered via the inventory features' `commands` hooks.
 */

import { EntityType, type Tile } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import { BuildingType, isStorageBuilding } from '../../buildings/types';
import { EMaterialType } from '../../economy';
import { SlotKind } from '../../core/pile-kind';
import type {
    PlacePileCommand,
    SetStorageFilterCommand,
    CommandResult,
    CommandFailure,
    SpawnResult,
} from '../../commands/command-types';
import { commandFailed, COMMAND_OK } from '../../commands/command-types';
import type { StorageFilterManager } from './storage-filter-manager';
import type { BuildingInventoryManager } from './building-inventory';

export interface PlacePileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    getOwner: (tile: Tile) => number;
}

export interface SetStorageFilterDeps {
    state: GameState;
    eventBus: EventBus;
    storageFilterManager: StorageFilterManager;
    inventoryManager: BuildingInventoryManager;
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

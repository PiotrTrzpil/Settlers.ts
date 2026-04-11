/**
 * Inventory query and injection helpers for test simulations.
 * Extracted from test-simulation.ts — convenience wrappers around BuildingInventoryManager.
 */

import { BuildingType, isStorageBuilding } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { SlotKind } from '@/game/core/pile-kind';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';
import type { GameState } from '@/game/game-state';
import type { GameServices } from '@/game/game-services';
import type { EntityType } from '@/game/entity';

export function injectInput(services: GameServices, buildingId: number, material: EMaterialType, amount: number): void {
    services.inventoryManager.depositInput(buildingId, material, amount);
}

export function injectOutput(
    state: GameState,
    services: GameServices,
    buildingId: number,
    material: EMaterialType,
    amount: number
): void {
    const entity = state.getEntityOrThrow(buildingId, 'injectOutput');
    const im = services.inventoryManager;

    // StorageArea slots start as NO_MATERIAL with kind=Storage — claim one before depositing
    if (isStorageBuilding(entity.subType as BuildingType)) {
        const existing = im.findSlotWithSpace(buildingId, material, SlotKind.Storage);
        if (!existing) {
            const free = im.findSlotWithSpace(buildingId, EMaterialType.NO_MATERIAL, SlotKind.Storage);
            if (!free) throw new Error(`injectOutput: no free slot on StorageArea ${buildingId} for ${material}`);
            im.setSlotMaterial(free.slotId, material);
        }
        const sfm = services.storageFilterManager;
        if (!sfm.getDirection(buildingId, material)) {
            sfm.setDirection(buildingId, material, StorageDirection.Both);
        }
    }

    im.depositOutput(buildingId, material, amount);
}

export function getOutput(services: GameServices, buildingId: number, material: EMaterialType): number {
    return services.inventoryManager.getOutputAmount(buildingId, material);
}

export function getInput(services: GameServices, buildingId: number, material: EMaterialType): number {
    return services.inventoryManager.getInputAmount(buildingId, material);
}

export function countEntities(state: GameState, type: EntityType, subType?: number | string): number {
    return state.entities.filter(e => e.type === type && (subType === undefined || e.subType === subType)).length;
}

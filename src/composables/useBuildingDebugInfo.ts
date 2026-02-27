/**
 * Composable for building debug info displayed in the selection panel.
 *
 * Aggregates construction state, inventory, and material request data for a selected building.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { RequestStatus } from '@/game/features/logistics/resource-request';
import type { Game } from '@/game/game';

export interface InventorySlotInfo {
    type: string;
    material: string;
    amount: number;
    reserved: number;
}

export interface RequestInfo {
    id: number;
    material: string;
    status: string;
    statusLabel: string;
}

export interface BuildingDebugInfo {
    isConstructing: boolean;
    constructionPhase: string;
    constructionProgress: number;
    hasProduction: boolean;
    pendingInputs: string[];
    hasInventory: boolean;
    inventorySlots: InventorySlotInfo[];
    requestCount: number;
    requests: RequestInfo[];
}

const PHASE_NAMES: Record<BuildingConstructionPhase, string> = {
    [BuildingConstructionPhase.Poles]: 'Poles',
    [BuildingConstructionPhase.TerrainLeveling]: 'Leveling',
    [BuildingConstructionPhase.ConstructionRising]: 'Rising',
    [BuildingConstructionPhase.CompletedRising]: 'Completing',
    [BuildingConstructionPhase.Completed]: 'Completed',
};

/**
 * Returns reactive building debug info for the given selected entity.
 *
 * @param game - Ref to the current Game instance (may be null)
 * @param selectedEntity - Ref to the currently selected entity (may be undefined)
 * @param tick - Ref to the game tick counter, used to trigger re-evaluation each frame
 */
export function useBuildingDebugInfo(
    game: Ref<Game | null>,
    selectedEntity: Ref<Entity | undefined>,
    tick: Ref<number>
): { buildingDebug: Ref<BuildingDebugInfo | null> } {
    const buildingDebug = computed<BuildingDebugInfo | null>(() => {
        // Touch tick to re-evaluate every frame (building state changes)
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Building) return null;
        if (!game.value) return null;

        const svc = game.value.services;
        const buildingState = svc.buildingStateManager.getBuildingState(entity.id);
        const inventory = svc.inventoryManager.getInventory(entity.id);
        const requests = [...svc.requestManager.getRequestsForBuilding(entity.id, false)];

        // Construction info
        const isConstructing =
            buildingState !== undefined && buildingState.phase !== BuildingConstructionPhase.Completed;
        let constructionPhase = '';
        let constructionProgress = 0;

        if (buildingState) {
            constructionPhase = PHASE_NAMES[buildingState.phase];
            constructionProgress =
                buildingState.totalDuration > 0
                    ? Math.round((buildingState.elapsedTime / buildingState.totalDuration) * 100)
                    : 0;
        }

        // Material request info - derive from RequestManager (source of truth)
        const activeRequests = requests.filter(
            r => r.status !== RequestStatus.Fulfilled && r.status !== RequestStatus.Cancelled
        );
        const hasProduction = activeRequests.length > 0 || inventory !== undefined;
        const pendingInputs = activeRequests.map(r => EMaterialType[r.materialType]);

        // Inventory info
        const hasInventory = inventory !== undefined;
        const inventorySlots: InventorySlotInfo[] = [];

        if (inventory) {
            const reservationManager = svc.logisticsDispatcher.getReservationManager();
            for (const slot of inventory.inputSlots) {
                const reserved = reservationManager.getReservedAmount(entity.id, slot.materialType);
                inventorySlots.push({
                    type: 'In',
                    material: EMaterialType[slot.materialType],
                    amount: slot.currentAmount,
                    reserved,
                });
            }
            for (const slot of inventory.outputSlots) {
                const reserved = reservationManager.getReservedAmount(entity.id, slot.materialType);
                inventorySlots.push({
                    type: 'Out',
                    material: EMaterialType[slot.materialType],
                    amount: slot.currentAmount,
                    reserved,
                });
            }
        }

        // Request info
        const requestInfos: RequestInfo[] = requests.slice(0, 5).map(req => ({
            id: req.id,
            material: EMaterialType[req.materialType],
            status: req.status === RequestStatus.InProgress ? 'progress' : 'pending',
            statusLabel: req.status === RequestStatus.InProgress ? '⚙' : '⏳',
        }));

        return {
            isConstructing,
            constructionPhase,
            constructionProgress,
            hasProduction,
            pendingInputs,
            hasInventory,
            inventorySlots,
            requestCount: requests.length,
            requests: requestInfos,
        };
    });

    return { buildingDebug };
}

/**
 * Composable for building debug info displayed in the selection panel.
 *
 * Aggregates construction state, inventory, and demand/job data for a selected building.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { SlotKind } from '@/game/core/pile-kind';
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
    [BuildingConstructionPhase.WaitingForDiggers]: 'Waiting for Diggers',
    [BuildingConstructionPhase.TerrainLeveling]: 'Leveling',
    [BuildingConstructionPhase.Evacuating]: 'Evacuating',
    [BuildingConstructionPhase.WaitingForBuilders]: 'Waiting for Builders',
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
        const site = svc.constructionSiteManager.getSite(entity.id);
        const slots = svc.inventoryManager.getSlots(entity.id);
        const hasSlots = svc.inventoryManager.hasSlots(entity.id);
        const activeJobs = svc.logisticsDispatcher.jobStore.getJobsForBuilding(entity.id);
        const demands = [...svc.demandQueue.getAllDemands()].filter(d => d.buildingId === entity.id);

        // Construction info
        const isConstructing = site !== undefined && site.phase !== BuildingConstructionPhase.Completed;
        let constructionPhase = '';
        let constructionProgress = 0;

        if (site) {
            constructionPhase = PHASE_NAMES[site.phase];
            // Show overall progress as percentage: phases 0-2 use levelingProgress, phase 3 uses constructionProgress
            if (site.phase <= BuildingConstructionPhase.WaitingForBuilders) {
                constructionProgress = Math.round(site.terrain.progress * 30);
            } else if (site.phase === BuildingConstructionPhase.ConstructionRising) {
                constructionProgress = 30 + Math.round(site.building.progress * 70);
            } else {
                constructionProgress = 100;
            }
        }

        // Material demand info — derive from demand queue and active jobs
        const hasProduction = demands.length > 0 || activeJobs.length > 0 || hasSlots;
        const pendingInputs = demands.map(d => EMaterialType[d.materialType]);

        // Inventory info
        const hasInventory = hasSlots;
        const inventorySlots: InventorySlotInfo[] = [];

        if (hasSlots) {
            const jobStore = svc.logisticsDispatcher.jobStore;
            for (const slot of slots) {
                if (slot.kind === SlotKind.Input) {
                    const reserved = jobStore.getReservedAmount(entity.id, slot.materialType);
                    inventorySlots.push({
                        type: 'In',
                        material: EMaterialType[slot.materialType],
                        amount: slot.currentAmount,
                        reserved,
                    });
                } else if (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage) {
                    const reserved = jobStore.getReservedAmount(entity.id, slot.materialType);
                    inventorySlots.push({
                        type: 'Out',
                        material: EMaterialType[slot.materialType],
                        amount: slot.currentAmount,
                        reserved,
                    });
                }
            }
        }

        // Request info — show active transport jobs targeting this building
        const requestInfos: RequestInfo[] = activeJobs.slice(0, 5).map(job => ({
            id: job.id,
            material: EMaterialType[job.material],
            status: job.phase,
            statusLabel: job.phase === 'picked-up' ? '⚙' : '⏳',
        }));

        return {
            isConstructing,
            constructionPhase,
            constructionProgress,
            hasProduction,
            pendingInputs,
            hasInventory,
            inventorySlots,
            requestCount: activeJobs.length + demands.length,
            requests: requestInfos,
        };
    });

    return { buildingDebug };
}

/**
 * Composable for the work-area adjustment button in the selection panel.
 *
 * Handles toggling the work-area adjust mode on/off for outdoor-worker buildings.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType, BuildingType } from '@/game/entity';
import { getBridge } from '@/game/debug-bridge';
import { BuildingAdjustMode } from '@/game/input/modes/building-adjust-mode';
import { WORK_AREA_BUILDINGS } from '@/game/features/work-areas';
import type { WorkAreaAdjustHandler } from '@/game/features/building-adjust/work-area-handler';

/** Get the BuildingAdjustMode if currently registered. */
function getAdjustMode(): BuildingAdjustMode | null {
    const input = getBridge().input;
    if (!input) return null;
    const mode = input.getMode('building-adjust');
    return mode instanceof BuildingAdjustMode ? mode : null;
}

/**
 * Returns whether the selected building has a work area and helpers to toggle it.
 *
 * @param selectedEntity - Ref to the currently selected entity (may be undefined)
 */
export function useWorkAreaAdjustment(selectedEntity: Ref<Entity | undefined>): {
    hasWorkArea: Ref<boolean>;
    isWorkAreaActive: Ref<boolean>;
    toggleWorkArea: () => void;
} {
    const hasWorkArea = computed(() => {
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Building) return false;
        return WORK_AREA_BUILDINGS.has(entity.subType as BuildingType);
    });

    const isWorkAreaActive = computed(() => {
        const mode = getAdjustMode();
        if (!mode) return false;
        const active = mode.getActiveAdjustment();
        return active?.item.category === 'work-area' && active.buildingId === selectedEntity.value?.id;
    });

    function toggleWorkArea(): void {
        const input = getBridge().input;
        if (!input) return;

        const entity = selectedEntity.value;
        if (!entity) return;

        const mode = getAdjustMode();
        if (!mode) return;

        // If already active, deactivate
        if (isWorkAreaActive.value) {
            mode.clearActiveItem();
            if (input.getModeName() === 'building-adjust') {
                input.switchMode('select');
            }
            return;
        }

        // Find the work-area handler and use the per-instance item
        const handlers = mode.getHandlers();
        for (const handler of handlers) {
            if (handler.category !== 'work-area') continue;
            if (!('getInstanceItem' in handler)) continue;
            const waHandler = handler as WorkAreaAdjustHandler;

            if (input.getModeName() !== 'building-adjust') {
                input.switchMode('building-adjust');
            }
            mode.setActiveItem(entity.id, waHandler.getInstanceItem(), waHandler);
            return;
        }
    }

    return { hasWorkArea, isWorkAreaActive, toggleWorkArea };
}

/**
 * Composable for the building adjustments UI in the selection panel.
 *
 * Manages the list of adjustable items for a selected building and handles
 * activating / deactivating adjustment mode via the BuildingAdjustMode.
 */

import { computed, ref, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType, BuildingType } from '@/game/entity';
import { getBridge } from '@/game/debug/debug-bridge';
import type { BuildingAdjustHandler, AdjustableItem } from '@/game/input/building-adjust/types';
import { BuildingAdjustMode } from '@/game/input/modes/building-adjust-mode';

export interface AdjustGroup {
    category: string;
    categoryLabel: string;
    handler: BuildingAdjustHandler;
    items: readonly AdjustableItem[];
}

/** Get the BuildingAdjustMode if currently registered. */
function getAdjustMode(): BuildingAdjustMode | null {
    const input = getBridge().input;
    if (!input) return null;
    const mode = input.getMode('building-adjust');
    return mode instanceof BuildingAdjustMode ? mode : null;
}

/**
 * Returns reactive adjustment state and actions for the given selected entity.
 *
 * @param selectedEntity - Ref to the currently selected entity (may be undefined)
 */
export function useBuildingAdjustments(selectedEntity: Ref<Entity | undefined>): {
    adjustExpanded: Ref<boolean>;
    adjustGroups: Ref<AdjustGroup[]>;
    activeAdjustKey: Ref<string | null>;
    toggleAdjustItem: (handler: BuildingAdjustHandler, item: AdjustableItem) => void;
    getItemOffsetLabel: (handler: BuildingAdjustHandler, item: AdjustableItem) => string;
} {
    const adjustExpanded = ref(false);

    const adjustGroups = computed<AdjustGroup[]>(() => {
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Building) return [];

        const mode = getAdjustMode();
        if (!mode) return [];

        const buildingType = entity.subType as BuildingType;
        const race = entity.race;
        const groups: AdjustGroup[] = [];

        for (const handler of mode.getHandlers()) {
            const items = handler.getItems(buildingType, race);
            if (items.length > 0) {
                groups.push({
                    category: handler.category,
                    categoryLabel: handler.categoryLabel,
                    handler,
                    items,
                });
            }
        }

        return groups;
    });

    const activeAdjustKey = computed<string | null>(() => {
        const mode = getAdjustMode();
        if (!mode) return null;
        const active = mode.getActiveAdjustment();
        return active?.item.key ?? null;
    });

    function toggleAdjustItem(handler: BuildingAdjustHandler, item: AdjustableItem): void {
        const input = getBridge().input;
        if (!input) return;

        const entity = selectedEntity.value;
        if (!entity) return;

        const mode = getAdjustMode();
        if (!mode) return;

        // If clicking the already-active item, deactivate
        const currentActive = mode.getActiveAdjustment();
        if (currentActive?.item.key === item.key) {
            mode.clearActiveItem();
            if (input.getModeName() === 'building-adjust') {
                input.switchMode('select');
            }
            return;
        }

        // Switch to building-adjust mode if not already in it
        if (input.getModeName() !== 'building-adjust') {
            input.switchMode('building-adjust');
        }

        mode.setActiveItem(entity.id, item, handler);
    }

    function getItemOffsetLabel(handler: BuildingAdjustHandler, item: AdjustableItem): string {
        const entity = selectedEntity.value;
        if (!entity) return '';

        const offset = handler.getOffset(entity.subType as BuildingType, entity.race, item.key);
        if (!offset) return '—';

        if ('dx' in offset) {
            return `${offset.dx},${offset.dy}`;
        }
        if ('px' in offset) {
            return `${offset.px},${offset.py}`;
        }
        return '—';
    }

    return {
        adjustExpanded,
        adjustGroups,
        activeAdjustKey,
        toggleAdjustItem,
        getItemOffsetLabel,
    };
}

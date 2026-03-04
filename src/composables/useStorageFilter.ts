/**
 * Composable for storage filter UI on StorageArea buildings.
 * Provides reactive state for per-material allow-lists and a toggle action.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { Game } from '@/game/game';
import type { Entity } from '@/game/entity';
import { BuildingType, EntityType } from '@/game/entity';
import { EMaterialType, DROPPABLE_MATERIALS } from '@/game/economy/material-type';

export interface StorageFilterItem {
    material: EMaterialType;
    name: string;
    allowed: boolean;
}

/**
 * Returns reactive storage-filter state and a toggle action for the selected StorageArea building.
 *
 * @param game - Ref to the current Game instance (may be null)
 * @param entity - Ref to the currently selected entity (may be null or undefined)
 * @param tick - Ref to the game tick counter, used to trigger re-evaluation each frame
 */
export function useStorageFilter(
    game: Ref<Game | null>,
    entity: Ref<Entity | null | undefined>,
    tick: Ref<number>
): {
    isStorageArea: ComputedRef<boolean>;
    storageFilter: ComputedRef<StorageFilterItem[]>;
    toggleMaterial: (material: EMaterialType) => void;
} {
    const isStorageArea = computed<boolean>(() => {
        const e = entity.value;
        if (!e) return false;
        if (e.type !== EntityType.Building) return false;
        if (e.subType !== BuildingType.StorageArea) return false;
        const isUnderConstruction = game.value?.services.constructionSiteManager.hasSite(e.id) ?? false;
        return !isUnderConstruction;
    });

    const storageFilter = computed<StorageFilterItem[]>(() => {
        // Touch tick to re-evaluate each frame
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;

        const e = entity.value;
        if (!e || !isStorageArea.value) return [];

        const sfm = game.value?.services.storageFilterManager;

        return DROPPABLE_MATERIALS.map(m => ({
            material: m,
            name: EMaterialType[m],
            allowed: sfm ? sfm.isAllowed(e.id, m) : false,
        }));
    });

    function toggleMaterial(material: EMaterialType): void {
        const e = entity.value;
        const g = game.value;
        if (!e || !g) return;
        const currentAllowed = g.services.storageFilterManager.isAllowed(e.id, material);
        g.execute({ type: 'set_storage_filter', buildingId: e.id, material, allowed: !currentAllowed });
    }

    return {
        isStorageArea,
        storageFilter,
        toggleMaterial,
    };
}

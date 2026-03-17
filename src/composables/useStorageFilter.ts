/**
 * Composable for storage filter UI on StorageArea buildings.
 * Provides reactive state for per-material direction settings and a cycle action.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { Game } from '@/game/game';
import type { Entity } from '@/game/entity';
import { BuildingType, EntityType, isStorageBuilding } from '@/game/entity';
import { EMaterialType, DROPPABLE_MATERIALS } from '@/game/economy/material-type';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';

export { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';

export interface StorageFilterItem {
    material: EMaterialType;
    name: string;
    /** null = disabled, otherwise the active direction */
    direction: StorageDirection | null;
}

/** Cycle order: null → Both → Import → Export → null */
const DIRECTION_CYCLE: ReadonlyArray<StorageDirection | null> = [
    null,
    StorageDirection.Both,
    StorageDirection.Import,
    StorageDirection.Export,
];

/**
 * Returns reactive storage-filter state and a cycle action for the selected StorageArea building.
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
    cycleDirection: (material: EMaterialType) => void;
    setDirection: (material: EMaterialType, direction: StorageDirection | null) => void;
} {
    const isStorageArea = computed<boolean>(() => {
        const e = entity.value;
        if (!e) {
            return false;
        }
        if (e.type !== EntityType.Building) {
            return false;
        }
        if (!isStorageBuilding(e.subType as BuildingType)) {
            return false;
        }
        const isUnderConstruction = game.value?.services.constructionSiteManager.hasSite(e.id) ?? false;
        return !isUnderConstruction;
    });

    const storageFilter = computed<StorageFilterItem[]>(() => {
        // Touch tick to re-evaluate each frame
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;

        const e = entity.value;
        if (!e || !isStorageArea.value) {
            return [];
        }

        const sfm = game.value?.services.storageFilterManager;

        return DROPPABLE_MATERIALS.map(m => ({
            material: m,
            name: m,
            direction: sfm ? sfm.getDirection(e.id, m) : null,
        }));
    });

    function setDirection(material: EMaterialType, direction: StorageDirection | null): void {
        const e = entity.value;
        const g = game.value;
        if (!e || !g) {
            return;
        }
        g.execute({ type: 'set_storage_filter', buildingId: e.id, material, direction });
    }

    function cycleDirection(material: EMaterialType): void {
        const e = entity.value;
        const g = game.value;
        if (!e || !g) {
            return;
        }
        const current = g.services.storageFilterManager.getDirection(e.id, material);
        const idx = DIRECTION_CYCLE.indexOf(current);
        const next = DIRECTION_CYCLE[(idx + 1) % DIRECTION_CYCLE.length]!;
        g.execute({ type: 'set_storage_filter', buildingId: e.id, material, direction: next });
    }

    return {
        isStorageArea,
        storageFilter,
        cycleDirection,
        setDirection,
    };
}

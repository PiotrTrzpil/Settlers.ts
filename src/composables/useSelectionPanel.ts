/**
 * Composable for core entity selection state in the selection panel.
 *
 * Provides computed values derived from the currently selected entity:
 * type checks, display name, icon, player color, and basic building status.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType, UnitType, BuildingType } from '@/game/entity';
import { getBuildingInfo } from '@/game/game-data-access';
import { UNIT_TYPE_CONFIG, getUnitCategory, UnitCategory } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy';
import type { Game } from '@/game/game';

// Player colors for display
const PLAYER_COLORS = [
    '#4a90d9', // Player 0 - Blue
    '#d94a4a', // Player 1 - Red
    '#4ad94a', // Player 2 - Green
    '#d9d94a', // Player 3 - Yellow
    '#9b4ad9', // Player 4 - Purple
    '#d9944a', // Player 5 - Orange
    '#4ad9d9', // Player 6 - Cyan
    '#d94a94', // Player 7 - Pink
];

/**
 * Returns core selection-panel state for the entity selected in the game.
 *
 * @param game - Ref to the current Game instance (may be null)
 */
export function useSelectionPanel(game: Ref<Game | null>): {
    selectedEntity: Ref<Entity | undefined>;
    selectionCount: Ref<number>;
    tick: Ref<number>;
    isUnit: Ref<boolean>;
    isBuilding: Ref<boolean>;
    entityTypeName: Ref<string>;
    entityIcon: Ref<string>;
    unitCategory: Ref<string>;
    carriedMaterial: Ref<string | null>;
    buildingSize: Ref<string>;
    buildingStatus: Ref<string | null>;
    playerColor: Ref<string | undefined>;
} {
    // Touch tick counter to force re-evaluation when entity properties change
    const tick = computed(() => game.value?.viewState.state.tick ?? 0);

    const selectedEntity = computed<Entity | undefined>(() => {
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;
        if (!game.value) return undefined;
        const entityId = game.value.viewState.state.selectedEntityId;
        if (entityId === null) return undefined;
        const entity = game.value.state.getEntity(entityId);
        // Return a shallow copy so Vue detects changes to entity properties
        return entity ? { ...entity } : undefined;
    });

    const selectionCount = computed(() => game.value?.viewState.state.selectedCount ?? 0);

    const isUnit = computed(() => selectedEntity.value?.type === EntityType.Unit);
    const isBuilding = computed(() => selectedEntity.value?.type === EntityType.Building);

    const entityTypeName = computed(() => {
        const entity = selectedEntity.value;
        if (!entity) return '';

        if (entity.type === EntityType.Unit) {
            const config = UNIT_TYPE_CONFIG[entity.subType as UnitType];
            return config.name;
        }

        if (entity.type === EntityType.Building) {
            const typeName = BuildingType[entity.subType as BuildingType];
            // Convert PascalCase to readable format (e.g., WoodcutterHut -> Woodcutter Hut)
            return typeName.replace(/([A-Z])/g, ' $1').trim();
        }

        return EntityType[entity.type];
    });

    const entityIcon = computed(() => {
        const entity = selectedEntity.value;
        if (!entity) return '?';

        if (entity.type === EntityType.Unit) {
            const unitType = entity.subType as UnitType;
            const category = getUnitCategory(unitType);
            switch (category) {
            case UnitCategory.Military:
                return '⚔️';
            case UnitCategory.Religious:
                return '🙏';
            case UnitCategory.Specialist:
                return '🎯';
            case UnitCategory.Worker:
                return '👷';
            }
        }

        if (entity.type === EntityType.Building) {
            return '🏠';
        }

        return '📦';
    });

    const unitCategory = computed(() => {
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Unit) return '';
        return getUnitCategory(entity.subType as UnitType);
    });

    const carriedMaterial = computed(() => {
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Unit) return null;
        const material = entity.carrying?.material;
        if (material === undefined) return null;
        return EMaterialType[material];
    });

    const buildingSize = computed(() => {
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Building) return '';
        const info = getBuildingInfo(entity.race, entity.subType as BuildingType);
        if (!info) return '';
        const w = info.boundingRect.maxX - info.boundingRect.minX + 1;
        const h = info.boundingRect.maxY - info.boundingRect.minY + 1;
        return `${w}x${h}`;
    });

    const buildingStatus = computed(() => {
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Building) return null;
        if (!game.value) return null;

        const isUnderConstruction = game.value.services.constructionSiteManager.hasSite(entity.id);
        return isUnderConstruction ? 'building' : 'completed';
    });

    const playerColor = computed(() => {
        const entity = selectedEntity.value;
        if (!entity) return PLAYER_COLORS[0];
        return PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
    });

    return {
        selectedEntity,
        selectionCount,
        tick,
        isUnit,
        isBuilding,
        entityTypeName,
        entityIcon,
        unitCategory,
        carriedMaterial,
        buildingSize,
        buildingStatus,
        playerColor,
    };
}

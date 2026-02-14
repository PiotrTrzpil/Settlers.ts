<template>
    <div class="selection-panel">
        <!-- Empty state when nothing selected -->
        <template v-if="!selectedEntity">
            <div class="panel-header">
                <span class="header-icon">👆</span>
                <span class="header-title">Selection</span>
            </div>
            <div class="panel-body">
                <div class="empty-state">Click to select a unit or building</div>
            </div>
        </template>

        <!-- Selected entity info -->
        <template v-else>
            <div class="panel-header">
                <span class="header-icon">{{ entityIcon }}</span>
                <span class="header-title">{{ entityTypeName }}</span>
                <span v-if="selectionCount > 1" class="multi-select-badge">+{{ selectionCount - 1 }}</span>
            </div>

            <div class="panel-body">
                <!-- Entity ID and Position -->
                <div class="info-row">
                    <span class="label">ID:</span>
                    <span class="value">#{{ selectedEntity.id }}</span>
                </div>
                <div class="info-row">
                    <span class="label">Position:</span>
                    <span class="value">({{ selectedEntity.x }}, {{ selectedEntity.y }})</span>
                </div>
                <div class="info-row">
                    <span class="label">Player:</span>
                    <span class="value player-badge" :style="{ background: playerColor }">
                        {{ selectedEntity.player }}
                    </span>
                </div>

                <!-- Unit-specific info -->
                <template v-if="isUnit">
                    <div class="info-section">
                        <div class="section-label">Unit Info</div>
                        <div class="info-row">
                            <span class="label">Category:</span>
                            <span class="value category-badge" :class="unitCategory">{{ unitCategory }}</span>
                        </div>
                        <div v-if="carriedMaterial" class="info-row">
                            <span class="label">Carrying:</span>
                            <span class="value">{{ carriedMaterial }}</span>
                        </div>
                    </div>
                </template>

                <!-- Building-specific info -->
                <template v-if="isBuilding">
                    <div class="info-section">
                        <div class="section-label">Building Info</div>
                        <div class="info-row">
                            <span class="label">Size:</span>
                            <span class="value">{{ buildingSize }}</span>
                        </div>
                        <div v-if="buildingStatus" class="info-row">
                            <span class="label">Status:</span>
                            <span class="value status-badge" :class="buildingStatus">{{ buildingStatus }}</span>
                        </div>
                    </div>
                </template>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType, UnitType, BuildingType, getBuildingSize } from '@/game/entity';
import { UNIT_TYPE_CONFIG, getUnitCategory, UnitCategory } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { debugStats } from '@/game/debug-stats';
import type { Game } from '@/game/game';

const props = defineProps<{
    game: Game | null;
}>();

// Use debugStats for reactivity (it's updated every frame)
const selectedEntity = computed<Entity | undefined>(() => {
    const entityId = debugStats.state.selectedEntityId;
    if (entityId === null || !props.game) return undefined;
    return props.game.state.getEntity(entityId);
});

const selectionCount = computed(() => debugStats.state.selectedCount);

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

const isUnit = computed(() => selectedEntity.value?.type === EntityType.Unit);
const isBuilding = computed(() => selectedEntity.value?.type === EntityType.Building);

// Get human-readable name for the entity subtype
const entityTypeName = computed(() => {
    const entity = selectedEntity.value;
    if (!entity) return '';

    if (entity.type === EntityType.Unit) {
        const config = UNIT_TYPE_CONFIG[entity.subType as UnitType];
        return config?.name ?? `Unit #${entity.subType}`;
    }

    if (entity.type === EntityType.Building) {
        const typeName = BuildingType[entity.subType as BuildingType];
        // Convert PascalCase to readable format (e.g., WoodcutterHut -> Woodcutter Hut)
        return typeName?.replace(/([A-Z])/g, ' $1').trim() ?? `Building #${entity.subType}`;
    }

    return EntityType[entity.type] ?? 'Unknown';
});

// Icon for the entity type
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

// Unit category for styling
const unitCategory = computed(() => {
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Unit) return '';
    return getUnitCategory(entity.subType as UnitType);
});

// Carried material for carriers (from entity.carrier state)
const carriedMaterial = computed(() => {
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Unit) return null;
    const material = entity.carrier?.carryingMaterial;
    if (material === undefined || material === null) return null;
    return EMaterialType[material] ?? `Material #${material}`;
});

// Building size
const buildingSize = computed(() => {
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Building) return '';
    const size = getBuildingSize(entity.subType as BuildingType);
    return `${size.width}x${size.height}`;
});

// Building construction state
const buildingStatus = computed(() => {
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Building) return null;
    if (!props.game) return null;

    const state = props.game.gameLoop.buildingStateManager.getBuildingState(entity.id);
    if (!state) return 'unknown';

    if (state.phase === BuildingConstructionPhase.Completed) return 'completed';
    return 'building';
});

// Player color
const playerColor = computed(() => {
    const entity = selectedEntity.value;
    if (!entity) return PLAYER_COLORS[0];
    return PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
});
</script>

<style scoped>
.selection-panel {
    background: rgba(13, 10, 5, 0.92);
    border: 1px solid #5c3d1a;
    border-radius: 4px;
    color: #c8a96e;
    font-size: 11px;
    font-family: monospace;
    min-width: 160px;
    pointer-events: auto;
}

.panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #2c1e0e;
    border-bottom: 1px solid #3a2a10;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.header-icon {
    font-size: 14px;
}

.header-title {
    flex: 1;
    color: #d4b27a;
}

.multi-select-badge {
    background: #4a3518;
    color: #e8c87e;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 9px;
}

.panel-body {
    padding: 6px 10px;
}

.info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
}

.label {
    color: #8a7040;
    font-size: 10px;
}

.value {
    color: #e8c87e;
}

.player-badge {
    padding: 1px 6px;
    border-radius: 3px;
    color: #fff;
    font-weight: bold;
    font-size: 10px;
}

.info-section {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid #2a1e0e;
}

.section-label {
    font-size: 9px;
    text-transform: uppercase;
    color: #6a5030;
    margin-bottom: 4px;
    letter-spacing: 0.5px;
}

.category-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    text-transform: capitalize;
}

.category-badge.military {
    background: #5a2020;
    color: #ff8080;
}

.category-badge.religious {
    background: #3a3a50;
    color: #a0a0ff;
}

.category-badge.specialist {
    background: #4a4020;
    color: #e0c060;
}

.category-badge.worker {
    background: #204020;
    color: #80c080;
}

.status-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    text-transform: capitalize;
}

.status-badge.completed {
    background: #204020;
    color: #80c080;
}

.status-badge.building {
    background: #4a4020;
    color: #e0c060;
}

.status-badge.unknown {
    background: #3a3a3a;
    color: #a0a0a0;
}

.empty-state {
    color: #6a5030;
    font-size: 10px;
    font-style: italic;
    text-align: center;
    padding: 4px 0;
}
</style>

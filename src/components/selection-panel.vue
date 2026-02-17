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
                <!-- Player info (always shown) -->
                <div class="info-row">
                    <span class="label">Player:</span>
                    <span class="value player-badge" :style="{ background: playerColor }">
                        {{ selectedEntity.player }}
                    </span>
                </div>

                <!-- Unit-specific info -->
                <template v-if="isUnit">
                    <div class="info-row">
                        <span class="label">Category:</span>
                        <span class="value category-badge" :class="unitCategory">{{ unitCategory }}</span>
                    </div>
                    <div v-if="carriedMaterial" class="info-row">
                        <span class="label">Carrying:</span>
                        <span class="value">{{ carriedMaterial }}</span>
                    </div>
                </template>

                <!-- Building-specific info -->
                <template v-if="isBuilding">
                    <div v-if="buildingStatus" class="info-row">
                        <span class="label">Status:</span>
                        <span class="value status-badge" :class="buildingStatus">{{ buildingStatus }}</span>
                    </div>
                </template>

                <!-- Debug Info Section (only when debug panel is open) -->
                <template v-if="showDebugInfo">
                    <div class="info-section debug-section">
                        <div class="section-label debug-label" @click="debugExpanded = !debugExpanded">
                            <span class="caret">{{ debugExpanded ? '▼' : '▶' }}</span>
                            Debug Info
                        </div>
                        <template v-if="debugExpanded">
                            <!-- Common debug info -->
                            <div class="info-row">
                                <span class="label">ID:</span>
                                <span class="value">#{{ selectedEntity.id }}</span>
                            </div>
                            <div class="info-row">
                                <span class="label">Position:</span>
                                <span class="value">({{ selectedEntity.x }}, {{ selectedEntity.y }})</span>
                            </div>
                            <div v-if="isBuilding" class="info-row">
                                <span class="label">Size:</span>
                                <span class="value">{{ buildingSize }}</span>
                            </div>

                            <!-- Carrier Debug Info -->
                            <template v-if="isUnit && carrierDebug">
                                <div class="info-row">
                                    <span class="label">Status:</span>
                                    <span class="value" :class="'carrier-status-' + carrierDebug.statusClass">
                                        {{ carrierDebug.status }}
                                    </span>
                                </div>
                                <div class="info-row">
                                    <span class="label">Fatigue:</span>
                                    <span class="value" :class="'fatigue-' + carrierDebug.fatigueClass">
                                        {{ carrierDebug.fatigue }}% ({{ carrierDebug.fatigueLevel }})
                                    </span>
                                </div>
                                <div class="info-row">
                                    <span class="label">Home:</span>
                                    <span class="value">#{{ carrierDebug.homeBuilding }}</span>
                                </div>
                                <template v-if="carrierDebug.pathLength > 0">
                                    <div class="info-row">
                                        <span class="label">Path:</span>
                                        <span class="value"
                                            >{{ carrierDebug.pathProgress }}/{{ carrierDebug.pathLength }}</span
                                        >
                                    </div>
                                </template>
                            </template>

                            <!-- Building Debug Info -->
                            <template v-if="isBuilding && buildingDebug">
                                <!-- Construction -->
                                <template v-if="buildingDebug.isConstructing">
                                    <div class="debug-subsection">Construction</div>
                                    <div class="info-row sub-row">
                                        <span class="label">Phase:</span>
                                        <span class="value">{{ buildingDebug.constructionPhase }}</span>
                                    </div>
                                    <div class="info-row sub-row">
                                        <span class="label">Progress:</span>
                                        <span class="value">{{ buildingDebug.constructionProgress }}%</span>
                                    </div>
                                </template>

                                <!-- Production -->
                                <template v-if="buildingDebug.hasProduction">
                                    <div class="debug-subsection">Material Requests</div>
                                    <div v-if="buildingDebug.pendingInputs.length > 0" class="info-row sub-row">
                                        <span class="label">Pending:</span>
                                        <span class="value">{{ buildingDebug.pendingInputs.join(', ') }}</span>
                                    </div>
                                </template>

                                <!-- Inventory -->
                                <template v-if="buildingDebug.hasInventory">
                                    <div class="debug-subsection">Inventory</div>
                                    <div
                                        v-for="slot in buildingDebug.inventorySlots"
                                        :key="slot.material"
                                        class="info-row sub-row"
                                    >
                                        <span class="label">{{ slot.type }}:</span>
                                        <span class="value">
                                            {{ slot.material }} {{ slot.amount }}
                                            <span v-if="slot.reserved > 0" class="reserved"
                                                >({{ slot.reserved }} res)</span
                                            >
                                        </span>
                                    </div>
                                </template>

                                <!-- Requests -->
                                <template v-if="buildingDebug.requestCount > 0">
                                    <div class="debug-subsection">Requests ({{ buildingDebug.requestCount }})</div>
                                    <div v-for="req in buildingDebug.requests" :key="req.id" class="info-row sub-row">
                                        <span class="label">#{{ req.id }}:</span>
                                        <span class="value">
                                            {{ req.material }}
                                            <span :class="'req-status-' + req.status">{{ req.statusLabel }}</span>
                                        </span>
                                    </div>
                                </template>
                            </template>
                        </template>
                    </div>
                </template>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType, UnitType, BuildingType, getBuildingSize } from '@/game/entity';
import { UNIT_TYPE_CONFIG, getUnitCategory, UnitCategory } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { getFatigueLevel } from '@/game/features/carriers/carrier-state';
import { RequestStatus } from '@/game/features/logistics/resource-request';
import { debugStats } from '@/game/debug-stats';
import {
    CARRIER_STATUS_NAMES,
    CARRIER_STATUS_CLASSES,
    FATIGUE_LEVEL_NAMES,
    FATIGUE_LEVEL_CLASSES,
} from '@/composables/useLogisticsDebug';
import type { Game } from '@/game/game';

const props = defineProps<{
    game: Game | null;
}>();

// Use gameViewState for reactivity (updated every tick from game loop)
// Touch tick counter to force re-evaluation when entity properties change
const selectedEntity = computed<Entity | undefined>(() => {
    void props.game!.viewState.state.tick;
    const entityId = props.game!.viewState.state.selectedEntityId;
    if (entityId === null || !props.game) return undefined;
    const entity = props.game.state.getEntity(entityId);
    // Return a shallow copy so Vue detects changes to entity properties
    return entity ? { ...entity } : undefined;
});

const selectionCount = computed(() => props.game!.viewState.state.selectedCount);

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

// Carried material for any unit (from entity.carrying state)
const carriedMaterial = computed(() => {
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Unit) return null;
    const material = entity.carrying?.material;
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

    const state = props.game.services.buildingStateManager.getBuildingState(entity.id);
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

// Debug section state
const debugExpanded = ref(true);

// Show debug info only when debug panel is open
const showDebugInfo = computed(() => debugStats.state.debugPanelOpen);

// Carrier debug info
interface CarrierDebugInfo {
    status: string;
    statusClass: string;
    fatigue: number;
    fatigueLevel: string;
    fatigueClass: string;
    homeBuilding: number;
    pathLength: number;
    pathProgress: number;
}

const carrierDebug = computed<CarrierDebugInfo | null>(() => {
    // Touch frameCount to re-evaluate every frame (carrier state changes frequently)
    void props.game!.viewState.state.tick;
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Unit) return null;
    if (!props.game) return null;

    const carrier = props.game.services.carrierManager.getCarrier(entity.id);
    if (!carrier) return null;
    const fatigueLevel = getFatigueLevel(carrier.fatigue);

    // Get path info from movement system
    const movement = props.game.state.movement.getController(entity.id);
    const pathLength = movement?.path.length ?? 0;
    const pathProgress = movement?.pathIndex ?? 0;

    return {
        status: CARRIER_STATUS_NAMES[carrier.status],
        statusClass: CARRIER_STATUS_CLASSES[carrier.status],
        fatigue: Math.round(carrier.fatigue),
        fatigueLevel: FATIGUE_LEVEL_NAMES[fatigueLevel],
        fatigueClass: FATIGUE_LEVEL_CLASSES[fatigueLevel],
        homeBuilding: carrier.homeBuilding,
        pathLength,
        pathProgress,
    };
});

// Building debug info
interface InventorySlotInfo {
    type: string;
    material: string;
    amount: number;
    reserved: number;
}

interface RequestInfo {
    id: number;
    material: string;
    status: string;
    statusLabel: string;
}

interface BuildingDebugInfo {
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

const buildingDebug = computed<BuildingDebugInfo | null>(() => {
    // Touch frameCount to re-evaluate every frame (building state changes)
    void props.game!.viewState.state.tick;
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Building) return null;
    if (!props.game) return null;

    const svc = props.game.services;
    const buildingState = svc.buildingStateManager.getBuildingState(entity.id);
    const inventory = svc.inventoryManager.getInventory(entity.id);
    const requests = [...svc.requestManager.getRequestsForBuilding(entity.id, false)];

    // Construction info
    const isConstructing = buildingState !== undefined && buildingState.phase !== BuildingConstructionPhase.Completed;
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
    const pendingInputs = activeRequests.map(r => EMaterialType[r.materialType] ?? `#${r.materialType}`);

    // Inventory info
    const hasInventory = inventory !== undefined;
    const inventorySlots: InventorySlotInfo[] = [];

    if (inventory) {
        for (const slot of inventory.inputSlots) {
            const reserved = svc.logisticsDispatcher
                .getReservationManager()
                .getReservedAmount(entity.id, slot.materialType);
            inventorySlots.push({
                type: 'In',
                material: EMaterialType[slot.materialType] ?? `#${slot.materialType}`,
                amount: slot.currentAmount,
                reserved,
            });
        }
        for (const slot of inventory.outputSlots) {
            const reserved = svc.logisticsDispatcher
                .getReservationManager()
                .getReservedAmount(entity.id, slot.materialType);
            inventorySlots.push({
                type: 'Out',
                material: EMaterialType[slot.materialType] ?? `#${slot.materialType}`,
                amount: slot.currentAmount,
                reserved,
            });
        }
    }

    // Request info
    const requestInfos: RequestInfo[] = requests.slice(0, 5).map(req => ({
        id: req.id,
        material: EMaterialType[req.materialType] ?? `#${req.materialType}`,
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

/* Debug Section */
.debug-section {
    border-top-color: #3a2a10;
}

.debug-label {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
}

.debug-label:hover {
    color: #8a7040;
}

.caret {
    font-size: 8px;
}

.debug-subsection {
    font-size: 9px;
    text-transform: uppercase;
    color: #5a4a30;
    margin-top: 4px;
    margin-bottom: 2px;
    padding-left: 4px;
    border-left: 2px solid #3a2a10;
}

.sub-row {
    padding-left: 8px;
}

.sub-row .label {
    font-size: 9px;
    color: #6a5a3a;
}

.sub-row .value {
    font-size: 9px;
}

/* Carrier status colors */
.carrier-status-idle {
    color: #80c080;
}

.carrier-status-walking {
    color: #80a0c0;
}

.carrier-status-pickingup {
    color: #c0a040;
}

.carrier-status-delivering {
    color: #a080c0;
}

.carrier-status-resting {
    color: #6090a0;
}

/* Fatigue colors */
.fatigue-fresh {
    color: #80c080;
}

.fatigue-tired {
    color: #e0c060;
}

.fatigue-exhausted {
    color: #e08040;
}

.fatigue-collapsed {
    color: #d04040;
}

/* Request status colors */
.req-status-pending {
    color: #c0a040;
}

.req-status-progress {
    color: #80c080;
}

.reserved {
    color: #7a6a4a;
    font-size: 8px;
}
</style>

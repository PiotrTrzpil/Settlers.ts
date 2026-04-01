<template>
    <div v-if="selectedEntity" class="selection-panel">
        <div class="panel-header">
            <span class="header-icon">{{ entityIcon }}</span>
            <span class="header-title">{{ entityTypeName }}</span>
            <Badge v-if="selectionCount > 1" color="count" :round="true">+{{ selectionCount - 1 }}</Badge>
        </div>

        <div class="panel-body">
            <!-- Player info (always shown) -->
            <StatRow label="Player">
                <span class="player-badge" :style="{ background: playerColor }">
                    {{ selectedEntity.player }}
                </span>
            </StatRow>

            <!-- Unit-specific info -->
            <template v-if="isUnit">
                <StatRow label="Category">
                    <span class="category-badge" :class="unitCategory">{{ unitCategory }}</span>
                </StatRow>
                <StatRow v-if="carriedMaterial" label="Carrying" :value="carriedMaterial" />
            </template>

            <!-- Building-specific info -->
            <template v-if="isBuilding">
                <StatRow v-if="buildingStatus" label="Status">
                    <span class="status-badge" :class="buildingStatus">{{ buildingStatus }}</span>
                </StatRow>

                <StatRow v-if="buildingWorkerIds.size > 0" label="Worker">
                    {{ [...buildingWorkerIds].map(id => '#' + id).join(', ') }}
                </StatRow>

                <!-- Construction info (shown only while building is under construction) -->
                <template v-if="constructionInfo">
                    <div class="info-section construction-section">
                        <div class="section-label">Construction</div>
                        <div class="construction-phase">{{ constructionInfo.phase }}</div>
                        <div class="construction-progress-bar">
                            <div
                                class="construction-progress-fill"
                                :style="{ width: Math.round(constructionInfo.overallProgress * 100) + '%' }"
                            ></div>
                        </div>
                        <div v-if="constructionInfo.materials.length > 0" class="construction-materials">
                            {{
                                constructionInfo.materials.map(m => `${m.delivered}/${m.required} ${m.name}`).join(', ')
                            }}
                        </div>
                    </div>
                </template>

                <!-- Operational UI (hidden during construction) -->
                <template v-if="!constructionInfo">
                    <!-- Work Area button (for buildings with outdoor workers) -->
                    <div v-if="hasWorkArea" class="work-area-row">
                        <button class="work-area-btn" :class="{ active: isWorkAreaActive }" @click="toggleWorkArea">
                            Set Work Area
                        </button>
                    </div>

                    <!-- Production Control (multi-recipe buildings only) -->
                    <template v-if="productionControl">
                        <div class="info-section production-section">
                            <div class="section-label">Production</div>

                            <!-- Mode selector -->
                            <div class="production-mode">
                                <button
                                    v-for="m in [
                                        ProductionMode.Even,
                                        ProductionMode.Proportional,
                                        ProductionMode.Manual,
                                    ]"
                                    :key="m"
                                    class="mode-btn"
                                    :class="{ active: productionControl.mode === m }"
                                    @click="setProductionMode(m)"
                                >
                                    {{ m }}
                                </button>
                            </div>

                            <!-- Even / Proportional mode: recipe weights -->
                            <template v-if="productionControl.mode !== ProductionMode.Manual">
                                <div class="recipe-grid">
                                    <div
                                        v-for="recipe in productionControl.recipes"
                                        :key="recipe.output"
                                        class="recipe-item"
                                    >
                                        <span class="recipe-name">{{ recipe.outputName }}</span>
                                        <div class="recipe-controls">
                                            <button
                                                class="recipe-btn"
                                                @click="setRecipeProportion(recipe.index, recipe.weight - 1)"
                                            >
                                                -
                                            </button>
                                            <span class="recipe-weight">{{ recipe.weight }}</span>
                                            <button
                                                class="recipe-btn"
                                                @click="setRecipeProportion(recipe.index, recipe.weight + 1)"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </template>

                            <!-- Manual mode: queue display + add/remove buttons -->
                            <template v-else>
                                <div v-if="productionControl.queue.length > 0" class="queue-display">
                                    {{ productionControl.queue.join(' → ') }}
                                </div>
                                <div v-else class="queue-empty">Queue empty (idle)</div>
                                <div class="recipe-grid">
                                    <div
                                        v-for="recipe in productionControl.recipes"
                                        :key="recipe.output"
                                        class="recipe-item"
                                    >
                                        <span class="recipe-name">{{ recipe.outputName }}</span>
                                        <div class="recipe-controls">
                                            <button class="recipe-btn" @click="addToProductionQueue(recipe.index)">
                                                +1
                                            </button>
                                            <button class="recipe-btn" @click="removeFromProductionQueue(recipe.index)">
                                                -1
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </template>

                    <!-- Garrison (shown for garrison buildings: GuardTowerSmall, GuardTowerBig, Castle) -->
                    <GarrisonPanel
                        v-if="selectedBuildingId !== null"
                        :building-id="selectedBuildingId"
                        :game="props.game"
                        :unit-icons="props.unitIcons"
                    />

                    <!-- Storage filter (shown only for StorageArea buildings, not under construction) -->
                    <StorageFilterPanel :game="props.game" />
                </template>

                <!-- Destroy button (shown for both construction sites and operational buildings) -->
                <div class="destroy-row">
                    <button v-if="!confirmingDestroy" class="destroy-btn" @click="confirmingDestroy = true">
                        Destroy
                    </button>
                    <template v-else>
                        <span class="destroy-confirm-label">Destroy building?</span>
                        <div class="destroy-confirm-actions">
                            <button class="destroy-btn destroy-confirm" @click="destroyBuilding">Confirm</button>
                            <button class="destroy-btn destroy-cancel" @click="confirmingDestroy = false">
                                Cancel
                            </button>
                        </div>
                    </template>
                </div>
            </template>

            <!-- Building Adjustments (only for buildings, only when debug panel is open) -->
            <template v-if="isBuilding && showDebugInfo && adjustGroups.length > 0">
                <div class="info-section adjust-section">
                    <div class="section-label adjust-label" @click="adjustExpanded = !adjustExpanded">
                        <span class="caret">{{ adjustExpanded ? '▼' : '▶' }}</span>
                        Adjustments
                    </div>
                    <template v-if="adjustExpanded">
                        <div v-for="group in adjustGroups" :key="group.category" class="adjust-group">
                            <div class="adjust-group-header">{{ group.categoryLabel }}</div>
                            <div
                                v-for="item in group.items"
                                :key="item.key"
                                class="adjust-item"
                                :class="{ active: activeAdjustKey === item.key }"
                                @click="toggleAdjustItem(group.handler, item)"
                            >
                                <span class="adjust-item-label">{{ item.label }}</span>
                                <span class="adjust-item-offset">{{ getItemOffsetLabel(group.handler, item) }}</span>
                                <span class="adjust-item-precision">{{
                                    item.precision === 'pixel' ? 'px' : 'tile'
                                }}</span>
                            </div>
                        </div>
                    </template>
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
                        <StatRow label="ID" :value="'#' + selectedEntity.id" />
                        <StatRow label="Position" :value="`(${selectedEntity.x}, ${selectedEntity.y})`" />
                        <StatRow v-if="isBuilding" label="Size" :value="buildingSize" />

                        <!-- Carrier Debug Info -->
                        <template v-if="isUnit && carrierDebug">
                            <StatRow label="Status">
                                <span :class="'carrier-status-' + carrierDebug.statusClass">
                                    {{ carrierDebug.status }}
                                </span>
                            </StatRow>
                            <StatRow
                                v-if="carrierDebug.pathLength > 0"
                                label="Path"
                                :value="`${carrierDebug.pathProgress}/${carrierDebug.pathLength}`"
                            />
                        </template>

                        <!-- Building Debug Info -->
                        <template v-if="isBuilding && buildingDebug">
                            <!-- Construction -->
                            <template v-if="buildingDebug.isConstructing">
                                <div class="debug-subsection">Construction</div>
                                <StatRow label="Phase" :value="buildingDebug.constructionPhase" :depth="1" />
                                <StatRow
                                    label="Progress"
                                    :value="buildingDebug.constructionProgress + '%'"
                                    :depth="1"
                                />
                            </template>

                            <!-- Production -->
                            <template v-if="buildingDebug.hasProduction">
                                <div class="debug-subsection">Material Requests</div>
                                <StatRow
                                    v-if="buildingDebug.pendingInputs.length > 0"
                                    label="Pending"
                                    :value="buildingDebug.pendingInputs.join(', ')"
                                    :depth="1"
                                />
                            </template>

                            <!-- Inventory -->
                            <template v-if="buildingDebug.hasInventory">
                                <div class="debug-subsection">Inventory</div>
                                <StatRow
                                    v-for="slot in buildingDebug.inventorySlots"
                                    :key="slot.material"
                                    :label="slot.type"
                                    :depth="1"
                                >
                                    {{ slot.material }} {{ slot.amount }}
                                    <span v-if="slot.reserved > 0" class="reserved">({{ slot.reserved }} res)</span>
                                </StatRow>
                            </template>

                            <!-- Requests -->
                            <template v-if="buildingDebug.requestCount > 0">
                                <div class="debug-subsection">Requests ({{ buildingDebug.requestCount }})</div>
                                <StatRow
                                    v-for="req in buildingDebug.requests"
                                    :key="req.id"
                                    :label="'#' + req.id"
                                    :depth="1"
                                >
                                    {{ req.material }}
                                    <span :class="'req-status-' + req.status">{{ req.statusLabel }}</span>
                                </StatRow>
                            </template>
                        </template>
                    </template>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Badge from './Badge.vue';
import StatRow from './StatRow.vue';
import { usePersistedRef } from '@/composables/use-persisted-ref';
import type { Game } from '@/game/game';
import { EntityType } from '@/game/entity';
import { useSelectionPanel } from '@/composables/useSelectionPanel';
import { useCarrierDebugInfo } from '@/composables/useCarrierDebugInfo';
import { useBuildingDebugInfo } from '@/composables/useBuildingDebugInfo';
import { useBuildingAdjustments } from '@/composables/useBuildingAdjustments';
import { useWorkAreaAdjustment } from '@/composables/useWorkAreaAdjustment';
import { useProductionControl } from '@/composables/useProductionControl';
import { useConstructionInfo } from '@/composables/useConstructionInfo';
import StorageFilterPanel from './StorageFilterPanel.vue';
import { ProductionMode } from '@/game/features/production-control';
import GarrisonPanel from './GarrisonPanel.vue';
import type { IconEntry } from '@/views/sprite-icon-loader';

const props = defineProps<{
    game: Game;
    unitIcons: Record<string, IconEntry>;
}>();

const gameRef = computed(() => props.game);

const {
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
    buildingWorkerIds,
    playerColor,
} = useSelectionPanel(gameRef);

const { carrierDebug } = useCarrierDebugInfo(gameRef, selectedEntity, tick);
const { buildingDebug } = useBuildingDebugInfo(gameRef, selectedEntity, tick);
const { adjustExpanded, adjustGroups, activeAdjustKey, toggleAdjustItem, getItemOffsetLabel } =
    useBuildingAdjustments(selectedEntity);
const { hasWorkArea, isWorkAreaActive, toggleWorkArea } = useWorkAreaAdjustment(selectedEntity);
const { productionControl, setProductionMode, setRecipeProportion, addToProductionQueue, removeFromProductionQueue } =
    useProductionControl(gameRef, selectedEntity, tick);
const { constructionInfo } = useConstructionInfo(gameRef, selectedEntity, tick);

const selectedBuildingId = computed<number | null>(() => {
    const entity = selectedEntity.value;
    if (!entity || entity.type !== EntityType.Building) {
        return null;
    }
    return entity.id;
});

// Debug section state
const debugExpanded = ref(true);

// Destroy building
const confirmingDestroy = ref(false);
// eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
const selectedEntityId = computed(() => selectedEntity.value?.id ?? null);
watch(selectedEntityId, () => (confirmingDestroy.value = false));

function destroyBuilding(): void {
    const entity = selectedEntity.value;
    if (!entity) {
        return;
    }
    props.game.execute({ type: 'remove_entity', entityId: entity.id });
    confirmingDestroy.value = false;
}

// Show debug info when debug panel is open (reads the same persisted key)
const debugPanelOpen = usePersistedRef('panel:debug', false);
const showDebugInfo = computed(() => debugPanelOpen.value);
</script>

<style scoped>
.selection-panel {
    background: rgba(13, 10, 5, 0.92);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text);
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
    background: var(--bg-mid);
    border-bottom: 1px solid var(--border-soft);
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.header-icon {
    font-size: 14px;
}

.header-title {
    flex: 1;
    color: var(--text-bright);
}

.panel-body {
    padding: 6px 10px;
}

/* StatRow overrides for in-game selection panel context */
.panel-body :deep(.stat-row) {
    padding: 3px 0;
    align-items: center;
}

.panel-body :deep(.stat-label) {
    color: var(--text-secondary);
    font-size: 10px;
}

.panel-body :deep(.stat-value) {
    color: var(--text-emphasis);
}

.panel-body :deep(.sub-1) {
    padding-left: 8px;
}

.panel-body :deep(.sub-1 .stat-label) {
    font-size: 9px;
    color: #6a5a3a;
}

.panel-body :deep(.sub-1 .stat-value) {
    font-size: 9px;
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
    border-top: 1px solid var(--border-faint);
}

.section-label {
    font-size: 9px;
    text-transform: uppercase;
    color: var(--text-dim);
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
    color: var(--status-warn);
}

.category-badge.worker {
    background: #204020;
    color: var(--status-good);
}

.status-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    text-transform: capitalize;
}

.status-badge.completed {
    background: #204020;
    color: var(--status-good);
}

.status-badge.building {
    background: #4a4020;
    color: var(--status-warn);
}

.status-badge.unknown {
    background: #3a3a3a;
    color: #a0a0a0;
}

.empty-state {
    color: var(--text-dim);
    font-size: 10px;
    font-style: italic;
    text-align: center;
    padding: 4px 0;
}

/* Debug Section */
.debug-section {
    border-top-color: var(--border-soft);
}

.debug-label {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
}

.debug-label:hover {
    color: var(--text-secondary);
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
    border-left: 2px solid var(--border-soft);
}

/* Carrier status colors */
.carrier-status-idle {
    color: var(--status-good);
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

/* Request status colors */
.req-status-pending {
    color: #c0a040;
}

.req-status-progress {
    color: var(--status-good);
}

.reserved {
    color: var(--text-muted);
    font-size: 8px;
}

/* Adjust Section */
.adjust-section {
    border-top-color: var(--border-soft);
}

.adjust-label {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
}

.adjust-label:hover {
    color: var(--text-secondary);
}

.adjust-group {
    margin-top: 2px;
}

.adjust-group-header {
    font-size: 8px;
    text-transform: uppercase;
    color: #5a4a30;
    letter-spacing: 0.5px;
    padding: 2px 0 1px;
}

.adjust-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    cursor: pointer;
    border-radius: 2px;
    font-size: 10px;
    color: var(--text-secondary);
}

.adjust-item:hover {
    background: rgba(60, 40, 16, 0.4);
    color: var(--text);
}

.adjust-item.active {
    background: rgba(80, 120, 200, 0.25);
    color: var(--text-bright);
}

.adjust-item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.adjust-item-offset {
    font-size: 9px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
}

.adjust-item-precision {
    font-size: 7px;
    text-transform: uppercase;
    color: #4a3a2a;
    min-width: 16px;
    text-align: right;
}

/* Work Area */
.work-area-row {
    padding: 4px 6px;
}

.work-area-btn {
    width: 100%;
    padding: 3px 8px;
    font-size: 10px;
    border: 1px solid rgba(180, 140, 80, 0.4);
    border-radius: 3px;
    background: rgba(60, 40, 16, 0.3);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s;
}

.work-area-btn:hover {
    background: rgba(80, 60, 20, 0.5);
    color: var(--text);
}

.work-area-btn.active {
    background: rgba(200, 140, 40, 0.3);
    border-color: rgba(220, 160, 60, 0.6);
    color: var(--text-bright);
}

/* Destroy Building */
.destroy-row {
    padding: 6px 6px 2px;
}

.destroy-btn {
    width: 100%;
    padding: 3px 8px;
    font-size: 10px;
    border: 1px solid rgba(180, 60, 60, 0.5);
    border-radius: 3px;
    background: rgba(100, 20, 20, 0.35);
    color: #d08080;
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s;
}

.destroy-btn:hover {
    background: rgba(140, 30, 30, 0.5);
    color: #ffa0a0;
}

.destroy-confirm-label {
    display: block;
    font-size: 10px;
    color: #e08080;
    margin-bottom: 4px;
    text-align: center;
}

.destroy-confirm-actions {
    display: flex;
    gap: 4px;
}

.destroy-confirm-actions .destroy-btn {
    width: auto;
    flex: 1;
}

.destroy-confirm {
    background: rgba(160, 30, 30, 0.5);
    border-color: rgba(200, 60, 60, 0.6);
    color: #ff9090;
}

.destroy-confirm:hover {
    background: rgba(180, 40, 40, 0.65);
    color: #ffb0b0;
}

.destroy-cancel {
    background: rgba(60, 50, 40, 0.3);
    border-color: rgba(120, 100, 80, 0.4);
    color: var(--text-secondary);
}

.destroy-cancel:hover {
    background: rgba(80, 60, 40, 0.4);
    color: var(--text);
}

/* Construction Info Section */
.construction-section {
    border-top-color: var(--border-soft);
}

.construction-phase {
    font-size: 10px;
    color: var(--status-warn);
    margin-bottom: 4px;
}

.construction-progress-bar {
    height: 6px;
    background: rgba(40, 30, 15, 0.5);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
    border: 1px solid rgba(120, 90, 40, 0.3);
}

.construction-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(180, 130, 40, 0.7), rgba(220, 170, 60, 0.9));
    border-radius: 3px;
    transition: width 0.1s ease;
}

.construction-materials {
    font-size: 9px;
    color: var(--text-secondary);
    word-break: break-word;
}

/* Production Control */
.production-section {
    border-top-color: var(--border-soft);
}

.production-mode {
    display: flex;
    gap: 2px;
    margin-bottom: 6px;
}

.mode-btn {
    flex: 1;
    padding: 2px 4px;
    font-size: 9px;
    text-transform: capitalize;
    border: 1px solid rgba(180, 140, 80, 0.3);
    border-radius: 2px;
    background: rgba(40, 30, 15, 0.4);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s;
}

.mode-btn:hover {
    background: rgba(60, 45, 20, 0.5);
    color: var(--text);
}

.mode-btn.active {
    background: rgba(180, 140, 60, 0.3);
    border-color: rgba(200, 160, 60, 0.5);
    color: var(--text-bright);
}

.recipe-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.recipe-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px;
    font-size: 10px;
}

.recipe-name {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.recipe-controls {
    display: flex;
    align-items: center;
    gap: 2px;
}

.recipe-btn {
    width: 18px;
    height: 16px;
    font-size: 10px;
    line-height: 1;
    border: 1px solid rgba(180, 140, 80, 0.3);
    border-radius: 2px;
    background: rgba(40, 30, 15, 0.4);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.recipe-btn:hover {
    background: rgba(80, 60, 25, 0.5);
    color: var(--text);
}

.recipe-weight {
    min-width: 14px;
    text-align: center;
    font-size: 10px;
    color: var(--text-emphasis);
    font-variant-numeric: tabular-nums;
}

.queue-display {
    font-size: 9px;
    color: var(--text-secondary);
    padding: 3px 4px;
    margin-bottom: 4px;
    background: rgba(30, 25, 15, 0.4);
    border-radius: 2px;
    overflow-x: auto;
    white-space: nowrap;
}

.queue-empty {
    font-size: 9px;
    color: var(--text-dim);
    font-style: italic;
    padding: 3px 4px;
    margin-bottom: 4px;
}
</style>

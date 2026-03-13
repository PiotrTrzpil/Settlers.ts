<template>
    <OverlayPanel v-model:open="open" label="Debug" title="Debug Panel">
        <DebugPerformanceSection />
        <DebugFrameTimings />
        <DebugMapLoadTimings />

        <!-- Entities -->
        <CollapseSection title="Entities">
            <StatRow label="Total" :value="view.entityCount" />
            <StatRow label="Buildings" :value="view.buildingCount" />
            <StatRow label="Units" :value="view.unitCount" />
            <StatRow label="Moving" :value="view.unitsMoving" />
            <StatRow label="Path steps" :value="view.totalPathSteps" />
        </CollapseSection>

        <!-- Camera -->
        <CollapseSection title="Camera">
            <StatRow label="Position" :value="`${stats.cameraX}, ${stats.cameraY}`" />
            <StatRow label="Zoom" :value="`${stats.zoom}x`" />
            <StatRow label="Canvas" :value="`${stats.canvasWidth} x ${stats.canvasHeight}`" />
            <div class="goto-row">
                <input
                    v-model="gotoTileCoords"
                    class="goto-input goto-input-wide"
                    type="text"
                    placeholder="x, y"
                    @keydown.enter="goToTile"
                />
                <button class="ctrl-btn" @click="goToTile">Go to tile</button>
            </div>
            <div class="goto-row">
                <input
                    v-model="gotoEntityId"
                    class="goto-input goto-input-wide"
                    type="number"
                    placeholder="Entity ID"
                    @keydown.enter="goToEntity"
                />
                <button class="ctrl-btn" @click="goToEntity">Go to entity</button>
            </div>
            <StatRow v-if="gotoEntityError" :label="gotoEntityError" dim />
        </CollapseSection>

        <!-- Tile -->
        <CollapseSection title="Tile">
            <template v-if="stats.hasTile">
                <StatRow label="Coords" :value="`${stats.tileX}, ${stats.tileY}`" />
                <StatRow label="Ground type" :value="stats.tileGroundType" />
                <StatRow label="Height" :value="stats.tileGroundHeight" />
            </template>
            <StatRow v-else label="Move mouse over map" dim />
        </CollapseSection>

        <!-- Controls -->
        <CollapseSection title="Controls">
            <div class="control-buttons">
                <button class="ctrl-btn" @click="$emit('togglePause')">
                    {{ paused ? 'Resume' : 'Pause' }}
                </button>
                <button class="ctrl-btn danger" @click="$emit('resetGameState')">Reset State</button>
            </div>
            <Checkbox v-model="selectAllUnits" label="All units selectable" />
        </CollapseSection>

        <!-- Pathfinding -->
        <CollapseSection title="Pathfinding" :default-open="false">
            <SettingsSlider v-model="settings.pathStraightness" label="Straightness" :min="1" :max="20" :step="1" />
            <StatRow label="" dim :value="straightnessHint" />
        </CollapseSection>

        <!-- Map Objects -->
        <CollapseSection title="Map Objects" :default-open="false">
            <Checkbox v-model="settings.darkLandDilation" label="Dark land gap filling" />
            <Checkbox
                v-model="treeExpansionEnabled"
                label="Tree expansion (reload)"
                @update:modelValue="onTreeExpansionChange"
            />
            <div class="map-obj-row">
                <span class="stat-label">Trees</span>
                <span class="stat-value">{{ mapObjectCounts.trees }}</span>
                <button class="spawn-btn" @click="spawnCategory(MapObjectCategory.Trees)">+</button>
            </div>
            <div class="map-obj-row">
                <span class="stat-label">Goods</span>
                <span class="stat-value">{{ mapObjectCounts.goods }}</span>
                <button class="spawn-btn" @click="spawnCategory(MapObjectCategory.Goods)">+</button>
            </div>
            <div class="map-obj-row">
                <span class="stat-label">Crops</span>
                <span class="stat-value">{{ mapObjectCounts.crops }}</span>
                <button class="spawn-btn" @click="spawnCategory(MapObjectCategory.Crops)">+</button>
            </div>
            <div class="map-obj-actions">
                <button class="ctrl-btn" @click="spawnAllFromMap()">From Map</button>
                <button class="ctrl-btn" @click="clearAllMapObjects()">Clear</button>
            </div>
            <StatRow v-if="!hasObjectTypeData" label="No map object data (test map)" dim />
        </CollapseSection>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { debugStats } from '@/game/debug/debug-stats';

import type { Game } from '@/game/game';
import { EntityType } from '@/game/entity';
import { isUnitTypeSelectable, UnitType } from '@/game/core/unit-types';
import { clearSavedTreeState } from '@/game/state/game-state-persistence';
import { MapObjectCategory } from '@/game/types/map-object-types';
import { useDebugMapObjects } from './use-debug-map-objects';
import Checkbox from './Checkbox.vue';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';
import OverlayPanel from './OverlayPanel.vue';
import DebugPerformanceSection from './DebugPerformanceSection.vue';
import DebugFrameTimings from './DebugFrameTimings.vue';
import DebugMapLoadTimings from './DebugMapLoadTimings.vue';
import SettingsSlider from './settings/SettingsSlider.vue';

const gotoTileCoords = ref('');

function goToTile(): void {
    const parts = gotoTileCoords.value
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number);
    if (parts.length < 2 || parts[0] === undefined || parts[1] === undefined) {
        return;
    }
    if (!isFinite(parts[0]) || !isFinite(parts[1])) {
        return;
    }
    window.__settlers__?.viewpoint?.setPosition(parts[0], parts[1]);
}

const gotoEntityId = ref<number | ''>('');
const gotoEntityError = ref('');

function goToEntity(): void {
    gotoEntityError.value = '';
    const id = Number(gotoEntityId.value);
    if (!isFinite(id) || gotoEntityId.value === '') {
        return;
    }
    const entity = props.game.state.getEntity(id);
    if (!entity) {
        gotoEntityError.value = `Entity ${id} not found`;
        return;
    }
    window.__settlers__?.viewpoint?.setPosition(entity.x, entity.y);
}

const props = defineProps<{
    paused: boolean;
    currentRace: number; // Race enum
    game: Game;
}>();

defineEmits<{
    (e: 'togglePause' | 'resetGameState'): void;
}>();

const stats = debugStats.state;
const settings = props.game.settings.state;
const view = props.game.viewState.state;
// Use the persisted open state from debug stats
const open = computed({
    get: () => stats.debugPanelOpen,
    set: (value: boolean) => {
        stats.debugPanelOpen = value;
    },
});

// Tree expansion toggle (persisted in localStorage, requires reload)
const treeExpansionEnabled = ref(localStorage.getItem('settlers_treeExpansion') !== 'false');
function onTreeExpansionChange(val: boolean): void {
    localStorage.setItem('settlers_treeExpansion', val ? 'true' : 'false');
    // Strip tree entities from saved state so next reload re-populates from map data
    clearSavedTreeState();
}

// Pathfinding straightness hint
const straightnessHint = computed(() => {
    const v = settings.pathStraightness;
    if (v <= 1) {
        return 'Max zigzag (shortest path)';
    }
    if (v <= 3) {
        return 'High zigzag';
    }
    if (v <= 6) {
        return 'Moderate zigzag';
    }
    if (v <= 10) {
        return 'Moderate straightness';
    }
    if (v <= 15) {
        return 'Straight paths';
    }
    return 'Very straight (sharp turns)';
});

// Debug setting: allow selecting all units (including workers)
const selectAllUnits = computed({
    get: () => debugStats.state.selectAllUnits,
    set: (value: boolean) => {
        debugStats.state.selectAllUnits = value;
    },
});

// When "select all units" is turned off, deselect any non-selectable units
watch(
    () => debugStats.state.selectAllUnits,
    newValue => {
        if (newValue) {
            return;
        }
        props.game.state.selection.deselectWhere(
            e => e.type === EntityType.Unit && !isUnitTypeSelectable(e.subType as UnitType)
        );
    }
);

// Map objects functionality (extracted to composable)
const getGame = (): Game | null => props.game;
const { mapObjectCounts, hasObjectTypeData, spawnCategory, spawnAllFromMap, clearAllMapObjects } =
    useDebugMapObjects(getGame);
</script>

<style scoped>
/* Stat label/value used directly in map-obj and river sections */
.stat-label {
    color: var(--text-muted);
}

.stat-value {
    color: var(--text-bright);
    text-align: right;
}

/* Camera go-to row */
.goto-row {
    display: flex;
    gap: 4px;
    margin-top: 4px;
    align-items: center;
}

.goto-input {
    width: 48px;
    padding: 3px 4px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 3px;
    font-size: 10px;
    font-family: monospace;
    text-align: center;
    /* hide number input spinners */
    -moz-appearance: textfield;
}

.goto-input::-webkit-outer-spin-button,
.goto-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
}

.goto-input:focus {
    outline: none;
    border-color: var(--border-hover);
}

.goto-input-wide {
    width: 80px;
    flex: 1;
}

/* Controls section */
.control-buttons {
    display: flex;
    gap: 4px;
    margin-top: 4px;
}

.ctrl-btn {
    flex: 1;
    padding: 4px 8px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    font-weight: bold;
    text-transform: uppercase;
}

.ctrl-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.ctrl-btn.active {
    background: #1a3a1a;
    border-color: #2a6a2a;
    color: var(--status-good);
}

.ctrl-btn.danger {
    background: #3a1a1a;
    border-color: #6a2020;
    color: #d08080;
}

.ctrl-btn.danger:hover {
    background: #4a2020;
    border-color: #8a3030;
}

/* River debug */
/* Map Objects section */
.map-obj-row {
    display: flex;
    align-items: center;
    padding: 2px 0;
    gap: 8px;
}

.map-obj-row .stat-label {
    flex: 1;
}

.map-obj-row .stat-value {
    min-width: 30px;
    text-align: right;
}

.spawn-btn {
    padding: 1px 6px;
    background: #1a3a1a;
    color: var(--status-good);
    border: 1px solid #2a5a2a;
    border-radius: 2px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    font-weight: bold;
    line-height: 1;
}

.spawn-btn:hover {
    background: #2a4a2a;
    border-color: #3a6a3a;
}

.map-obj-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
}
</style>

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
import { computed, ref } from 'vue';
import { debugStats } from '@/game/debug-stats';

import type { Game } from '@/game/game';
import { clearSavedTreeState } from '@/game/game-state-persistence';
import { MapObjectCategory } from '@/game/types/map-object-types';
import { useDebugMapObjects } from './use-debug-map-objects';
import Checkbox from './Checkbox.vue';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';
import OverlayPanel from './OverlayPanel.vue';
import DebugPerformanceSection from './DebugPerformanceSection.vue';
import DebugFrameTimings from './DebugFrameTimings.vue';
import DebugMapLoadTimings from './DebugMapLoadTimings.vue';

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

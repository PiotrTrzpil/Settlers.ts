<template>
  <div class="map-view-root">
    <!-- Main game area: sidebar + canvas -->
    <div v-if="game" class="game-layout" data-testid="game-ui">

      <!-- LEFT SIDEBAR -->
      <aside class="sidebar">
        <!-- Race selector at top of sidebar -->
        <div class="race-selector-sidebar">
          <label>Race:</label>
          <select v-model="currentRace" @change="onRaceChange" data-testid="race-select">
            <option v-for="race in availableRaces" :key="race.value" :value="race.value">
              {{ race.name }}
            </option>
          </select>
        </div>

        <!-- Tab strip -->
        <div class="sidebar-tabs">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'buildings' }"
            @click="activeTab = 'buildings'"
          >Buildings</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'units' }"
            @click="activeTab = 'units'"
          >Units</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'resources' }"
            @click="activeTab = 'resources'"
          >Resources</button>
        </div>

        <!-- Buildings tab -->
        <div v-if="activeTab === 'buildings'" class="tab-content building-list" data-testid="building-palette">
          <SettingsCheckbox v-model="placeBuildingsCompleted" label="Place as completed" />
          <SettingsCheckbox v-model="placeBuildingsWithWorker" label="Place with worker" />
          <button
            v-for="b in availableBuildings"
            :key="b.type"
            class="sidebar-btn"
            :data-testid="'btn-' + b.id"
            :class="{ active: currentMode === 'place_building' && placeBuildingType === b.type }"
            @click="setPlaceMode(b.type)"
          >
            <span class="btn-icon">
              <img
                v-if="getIconUrl(b.type)"
                :src="getIconUrl(b.type, currentMode === 'place_building' && placeBuildingType === b.type)!"
                :alt="b.name"
                class="building-icon-img"
              />
              <span v-else>{{ b.icon }}</span>
            </span>
            <span class="btn-label">{{ b.name }}</span>
          </button>
        </div>

        <!-- Units tab -->
        <div v-if="activeTab === 'units'" class="tab-content" data-testid="unit-controls">
          <button
            v-for="u in availableUnits"
            :key="u.type"
            class="sidebar-btn"
            :data-testid="'btn-spawn-' + u.id"
            :class="{ active: currentMode === 'place_unit' && placeUnitType === u.type }"
            @click="setPlaceUnitMode(u.type)"
          >
            <span class="btn-icon">{{ u.icon }}</span>
            <span class="btn-label">{{ u.name }}</span>
          </button>
        </div>

        <!-- Resources tab -->
        <div v-if="activeTab === 'resources'" class="tab-content" data-testid="resource-palette">
          <div class="resource-params">
            <label>Amount:</label>
            <input type="number" v-model.number="resourceAmount" min="1" max="8" class="amount-input" />
          </div>
          <button
            v-for="r in availableResources"
            :key="r.type"
            class="sidebar-btn"
            :data-testid="'btn-resource-' + r.id"
            :class="{ active: currentMode === 'place_resource' && placeResourceType === r.type }"
            @click="setPlaceResourceMode(r.type)"
          >
             <span class="btn-icon">
                <img v-if="resourceIcons[r.type]" :src="resourceIcons[r.type]" class="resource-icon" />
                <span v-else>{{ r.icon }}</span>
             </span>
             <span class="btn-label">{{ r.name }}</span>
          </button>
        </div>

        <!-- Mode controls at bottom -->
        <div class="sidebar-footer">
          <button
            class="sidebar-btn mode-btn"
            data-testid="btn-select-mode"
            :class="{ active: currentMode === 'select' }"
            @click="setSelectMode()"
          >Select</button>
          <button
            class="sidebar-btn mode-btn"
            data-testid="btn-remove-entity"
            :disabled="!selectedEntity"
            @click="removeSelected()"
          >Delete</button>
          <button
            class="sidebar-btn mode-btn"
            data-testid="btn-pause"
            :class="{ active: isPaused }"
            @click="togglePause()"
          >{{ isPaused ? 'Resume' : 'Pause' }}</button>
        </div>
      </aside>

      <!-- RIGHT: Canvas area + info bar -->
      <div class="canvas-area">
        <!-- Info bar -->
        <div class="info-bar">
          <div class="map-selector">
            <span class="info-label">Map:</span>
            <file-browser
              :fileManager="fileManager"
              @select="onFileSelect"
              filter=".map"
              storageKey="viewer_map_file"
              class="browser"
            />
          </div>
          <div class="mode-indicator" data-testid="mode-indicator" :data-mode="currentMode">
            Mode: <strong>{{ currentMode }}</strong>
          </div>
          <div class="entity-count" data-testid="entity-count"
            :data-count="game.state.entities.length">
            Entities: {{ game.state.entities.length }}
          </div>
          <div class="tile-info" data-testid="tile-info" v-if="hoveredTile"
            :data-tile-x="hoveredTile.x" :data-tile-y="hoveredTile.y">
            Tile: ({{ hoveredTile.x }}, {{ hoveredTile.y }})
          </div>
          <div class="entity-info" data-testid="entity-info" v-if="selectedEntity"
            :data-entity-id="selectedEntity.id" :data-selection-count="selectionCount">
            Selected: {{ selectedEntity.type === 1 ? 'Unit' : 'Building' }}
            #{{ selectedEntity.id }}
            at ({{ selectedEntity.x }}, {{ selectedEntity.y }})
            <span v-if="selectionCount > 1"> (+{{ selectionCount - 1 }} more)</span>
          </div>
        </div>

        <!-- Canvas fills remaining space -->
        <renderer-viewer
          ref="rendererRef"
          :game="game"
          :debugGrid="showDebug"
          :layerVisibility="layerVisibility"
          @tileClick="onTileClick"
          class="game-canvas"
        />

        <!-- Left panel container (selection info) -->
        <div class="left-panels">
          <selection-panel :game="game" />
        </div>

        <!-- Right panel container (layers + settings + debug) -->
        <div class="right-panels">
          <layer-panel
            :counts="layerCounts"
            @update:visibility="updateLayerVisibility"
          />
          <settings-panel />
          <debug-panel
            :paused="isPaused"
            :currentRace="currentRace"
            @togglePause="togglePause()"
            @resetGameState="resetGameState()"
          />
        </div>
      </div>
    </div>

    <!-- Fallback when no game loaded -->
    <div v-if="!game" class="no-game-fallback">
      <div class="info-bar">
        <div class="map-selector">
          <span class="info-label">Map:</span>
          <file-browser
            :fileManager="fileManager"
            @select="onFileSelect"
            filter=".map"
            class="browser"
          />
        </div>
      </div>
      <renderer-viewer
        :game="game"
        :debugGrid="showDebug"
        :layerVisibility="layerVisibility"
        @tileClick="onTileClick"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useTemplateRef } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { useMapView } from './use-map-view';
import { useBuildingIcons } from '@/composables/useBuildingIcons';
import { Race, RACE_NAMES, AVAILABLE_RACES } from '@/game/renderer/sprite-metadata';
import { gameSettings } from '@/game/game-settings';
import { SoundManager } from '@/game/audio/sound-manager';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';
import DebugPanel from '@/components/debug-panel.vue';
import LayerPanel from '@/components/layer-panel.vue';
import SettingsPanel from '@/components/settings-panel.vue';
import SelectionPanel from '@/components/selection-panel.vue';
import SettingsCheckbox from '@/components/settings/SettingsCheckbox.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

// Template ref for renderer - declared before useMapView so getter works
const rendererRef = useTemplateRef<InstanceType<typeof RendererViewer>>('rendererRef');

const {
    game,
    showDebug,
    activeTab,
    resourceAmount,
    resourceIcons,
    hoveredTile,
    selectedEntity,
    selectionCount,
    isPaused,
    currentMode,
    placeBuildingType,
    placeResourceType,
    placeUnitType,
    availableBuildings,
    availableUnits,
    availableResources,
    layerVisibility,
    layerCounts,
    onFileSelect,
    onTileClick,
    setPlaceMode,
    setPlaceResourceMode,
    setPlaceUnitMode,
    setSelectMode,
    removeSelected,
    togglePause,
    resetGameState,
    updateLayerVisibility
} = useMapView(
    () => props.fileManager,
    () => rendererRef.value?.getInputManager?.() ?? null
);

// Race selection
const currentRace = ref<Race>(Race.Roman);

const availableRaces = AVAILABLE_RACES.map(race => ({
    value: race,
    name: RACE_NAMES[race]
}));

// Building icons
const fileManagerRef = computed(() => props.fileManager);
const { getIconUrl } = useBuildingIcons(fileManagerRef, currentRace);

// Building placement options
const placeBuildingsCompleted = computed({
    get: () => gameSettings.state.placeBuildingsCompleted,
    set: (value: boolean) => { gameSettings.state.placeBuildingsCompleted = value }
});

const placeBuildingsWithWorker = computed({
    get: () => gameSettings.state.placeBuildingsWithWorker,
    set: (value: boolean) => { gameSettings.state.placeBuildingsWithWorker = value }
});

async function onRaceChange() {
    const renderer = rendererRef.value;
    if (renderer && typeof renderer.setRace === 'function') {
        await renderer.setRace(currentRace.value);
    }
    // Switch music to match the selected race
    SoundManager.getInstance().playRandomMusic(currentRace.value);
}
</script>

<style scoped>
/* ===== ROOT WRAPPER ===== */
.map-view-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* ===== MAIN GAME LAYOUT ===== */
.game-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  background: #0d0a05;
}

/* ===== LEFT SIDEBAR ===== */
.sidebar {
  width: 180px;
  min-width: 180px;
  background: linear-gradient(180deg, #2c1e0e 0%, #1a1209 100%);
  border-right: 3px solid #5c3d1a;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-tabs {
  display: flex;
  border-bottom: 2px solid #5c3d1a;
}

.tab-btn {
  flex: 1;
  padding: 10px 4px;
  background: #1a1209;
  color: #8a7040;
  border: none;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: background 0.15s, color 0.15s;
}

.tab-btn:hover {
  background: #2c1e0e;
  color: #c8a96e;
}

.tab-btn.active {
  background: #3a2810;
  color: #e8c87e;
  border-bottom-color: #d4a030;
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  overflow-y: auto;
}

.building-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
  background: #2c1e0e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  color: #c8a96e;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.building-option:hover {
  background: #3a2810;
  border-color: #6a4a20;
}


.resource-params {
  padding: 8px;
  background: #2c1e0e;
  border-bottom: 1px solid #4a3218;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #c8a96e;
  flex-shrink: 0;
}

.amount-input {
  width: 40px;
  background: #1a1209;
  border: 1px solid #4a3218;
  color: #e8c87e;
  border-radius: 3px;
  padding: 2px 4px;
}

/* ===== SIDEBAR BUTTONS ===== */
.sidebar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 6px;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}

.sidebar-btn:hover {
  background: #3a2810;
  border-color: #6a4a20;
}

.sidebar-btn.active {
  background: #4a3518;
  border-color: #d4a030;
  color: #ffe8a0;
  box-shadow: inset 0 0 8px rgba(212, 160, 48, 0.2);
}

.sidebar-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.btn-icon {
  font-size: 14px;
  width: 32px;
  height: 32px;
  text-align: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.building-icon-img {
  max-width: 32px;
  max-height: 32px;
  object-fit: contain;
  image-rendering: pixelated;
}

.resource-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(1px 1px 0 rgba(0,0,0,0.5));
}

.btn-label {
  flex: 1;
}

/* ===== SIDEBAR FOOTER (mode controls) ===== */
.sidebar-footer {
  margin-top: auto;
  border-top: 2px solid #5c3d1a;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mode-btn {
  justify-content: center;
  font-weight: bold;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.5px;
}

/* ===== CANVAS AREA ===== */
.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.info-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 12px;
  background: #1a1209;
  border-bottom: 2px solid #5c3d1a;
  align-items: center;
  z-index: 10;
}

.map-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  font-weight: bold;
  color: #d4b27a;
  font-size: 13px;
}

.no-game-fallback {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.mode-indicator {
  padding: 3px 8px;
  background: #2c1e0e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  color: #c8a96e;
  font-size: 12px;
}

.mode-indicator strong {
  color: #e8c87e;
}

.tile-info,
.entity-info {
  padding: 3px 8px;
  background: #1a2a1a;
  border: 1px solid #2a4a2a;
  border-radius: 3px;
  color: #80c080;
  font-size: 12px;
}

.entity-count {
  padding: 3px 8px;
  background: #2a1a1a;
  border: 1px solid #4a2a2a;
  border-radius: 3px;
  color: #d09060;
  font-size: 12px;
}

.race-selector-sidebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #1a1209;
  border-bottom: 2px solid #5c3d1a;
  color: #c8a96e;
  font-size: 13px;
}

.race-selector-sidebar label {
  font-weight: bold;
  color: #d4b27a;
}

.race-selector-sidebar select {
  flex: 1;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 13px;
  cursor: pointer;
}

.race-selector-sidebar select:hover {
  border-color: #6a4a20;
  background: #3a2810;
}

/* Canvas fills remaining space */
.game-canvas {
  flex: 1;
  min-height: 0;
}

/* Left panels container (selection info) */
.left-panels {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  z-index: 100;
  max-height: calc(100% - 16px);
  pointer-events: none;
}

/* Right panels container */
.right-panels {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  z-index: 100;
  max-height: calc(100% - 16px);
  pointer-events: none;
}

.game-canvas :deep(.cav) {
  width: 100%;
  height: 100%;
  display: block;
  margin: 0;
  border: none;
}

/* ===== SCROLLBAR ===== */
.sidebar::-webkit-scrollbar {
  width: 6px;
}

.sidebar::-webkit-scrollbar-track {
  background: #1a1209;
}

.sidebar::-webkit-scrollbar-thumb {
  background: #4a3218;
  border-radius: 3px;
}

.sidebar::-webkit-scrollbar-thumb:hover {
  background: #5c3d1a;
}
</style>

<template>
  <div class="map-view-root">
    <!-- Header bar: file browser + debug toggle -->
    <div class="game-header">
      <div class="header-row">
        <span class="header-label">Map:</span>
        <file-browser
          :fileManager="fileManager"
          @select="onFileSelect"
          filter=".map"
          class="browser"
        />
      </div>
      <pre v-if="mapInfo" class="map-info-pre">{{ mapInfo }}</pre>
    </div>

    <!-- Main game area: sidebar + canvas -->
    <div v-if="game" class="game-layout" data-testid="game-ui">

      <!-- LEFT SIDEBAR -->
      <aside class="sidebar">
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
        </div>

        <!-- Buildings tab -->
        <div v-if="activeTab === 'buildings'" class="tab-content" data-testid="building-palette">
          <button
            class="sidebar-btn"
            data-testid="btn-guardhouse"
            :class="{ active: game.mode === 'place_building' && game.placeBuildingType === 0 }"
            @click="setPlaceMode(0)"
          >
            <span class="btn-icon">&#x1F3F0;</span>
            <span class="btn-label">Guardhouse</span>
          </button>
          <button
            class="sidebar-btn"
            data-testid="btn-lumberjack"
            :class="{ active: game.mode === 'place_building' && game.placeBuildingType === 1 }"
            @click="setPlaceMode(1)"
          >
            <span class="btn-icon">&#x1FA93;</span>
            <span class="btn-label">Lumberjack</span>
          </button>
          <button
            class="sidebar-btn"
            data-testid="btn-warehouse"
            :class="{ active: game.mode === 'place_building' && game.placeBuildingType === 2 }"
            @click="setPlaceMode(2)"
          >
            <span class="btn-icon">&#x1F4E6;</span>
            <span class="btn-label">Warehouse</span>
          </button>
        </div>

        <!-- Units tab -->
        <div v-if="activeTab === 'units'" class="tab-content" data-testid="unit-controls">
          <button
            class="sidebar-btn"
            data-testid="btn-spawn-settler"
            @click="spawnUnit(0)"
          >
            <span class="btn-icon">&#x1F9D1;</span>
            <span class="btn-label">Settler</span>
          </button>
          <button
            class="sidebar-btn"
            data-testid="btn-spawn-soldier"
            @click="spawnUnit(1)"
          >
            <span class="btn-icon">&#x2694;</span>
            <span class="btn-label">Soldier</span>
          </button>
        </div>

        <!-- Mode controls at bottom -->
        <div class="sidebar-footer">
          <button
            class="sidebar-btn mode-btn"
            data-testid="btn-select-mode"
            :class="{ active: game.mode === 'select' }"
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
          <div class="mode-indicator" data-testid="mode-indicator" :data-mode="game.mode">
            Mode: <strong>{{ game.mode }}</strong>
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
          <div class="entity-count" data-testid="entity-count"
            :data-count="game.state.entities.length">
            Entities: {{ game.state.entities.length }}
          </div>
        </div>

        <!-- Canvas fills remaining space -->
        <renderer-viewer
          :game="game"
          :debugGrid="showDebug"
          :showTerritoryBorders="showTerritoryBorders"
          @tileClick="onTileClick"
          class="game-canvas"
        />

        <!-- Debug panel overlay -->
        <debug-panel
          :debugGrid="showDebug"
          :showTerritoryBorders="showTerritoryBorders"
          :paused="isPaused"
          @update:debugGrid="showDebug = $event"
          @update:showTerritoryBorders="showTerritoryBorders = $event"
          @togglePause="togglePause()"
        />
      </div>
    </div>

    <!-- Fallback when no game loaded -->
    <renderer-viewer
      v-if="!game"
      :game="game"
      :debugGrid="showDebug"
      :showTerritoryBorders="showTerritoryBorders"
      @tileClick="onTileClick"
    />
  </div>
</template>

<script setup lang="ts">
import { FileManager } from '@/utilities/file-manager';
import { useMapView } from './use-map-view';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';
import DebugPanel from '@/components/debug-panel.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const {
    mapInfo,
    game,
    showDebug,
    showTerritoryBorders,
    activeTab,
    hoveredTile,
    selectedEntity,
    selectionCount,
    isPaused,
    onFileSelect,
    onTileClick,
    setPlaceMode,
    setSelectMode,
    removeSelected,
    togglePause,
    spawnUnit
} = useMapView(() => props.fileManager);
</script>

<style scoped>
/* ===== ROOT WRAPPER ===== */
.map-view-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* ===== GAME HEADER ===== */
.game-header {
  background: #1a1209;
  border-bottom: 2px solid #5c3d1a;
  padding: 6px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  color: #c8a96e;
  font-size: 13px;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.header-label {
  font-weight: bold;
  color: #d4b27a;
}


.map-info-pre {
  width: 100%;
  margin: 4px 0 0;
  padding: 4px 8px;
  background: #0d0a05;
  color: #7a6a4a;
  font-size: 11px;
  border-radius: 3px;
  max-height: 60px;
  overflow: auto;
  border: 1px solid #3a2a10;
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
  gap: 4px;
  padding: 8px;
}

/* ===== SIDEBAR BUTTONS ===== */
.sidebar-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
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
  font-size: 20px;
  width: 28px;
  text-align: center;
  flex-shrink: 0;
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
  background: rgba(26, 18, 9, 0.92);
  border-bottom: 1px solid #3a2a10;
  align-items: center;
  z-index: 10;
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
  margin-left: auto;
  padding: 3px 8px;
  background: #2a1a1a;
  border: 1px solid #4a2a2a;
  border-radius: 3px;
  color: #d09060;
  font-size: 12px;
}

/* Canvas fills remaining space */
.game-canvas {
  flex: 1;
  min-height: 0;
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

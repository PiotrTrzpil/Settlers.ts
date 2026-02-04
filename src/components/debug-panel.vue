<template>
  <div class="debug-panel" :class="{ collapsed: !open }">
    <button class="debug-toggle-btn" @click="open = !open" title="Debug Panel">
      <span class="toggle-icon">{{ open ? '&#x25BC;' : '&#x25B6;' }}</span>
      <span class="toggle-label">Debug</span>
      <span class="fps-badge" v-if="!open">{{ stats.fps }} fps</span>
    </button>

    <div v-if="open" class="debug-sections">
      <!-- Performance -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.perf = !sections.perf">
          <span class="caret">{{ sections.perf ? '&#x25BC;' : '&#x25B6;' }}</span>
          Performance
        </h3>
        <div v-if="sections.perf" class="section-body">
          <div class="stat-row">
            <span class="stat-label">FPS</span>
            <span class="stat-value" :class="fpsClass">{{ stats.fps }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Frame (avg)</span>
            <span class="stat-value">{{ stats.frameTimeMs }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Frame (min/max)</span>
            <span class="stat-value">{{ stats.frameTimeMin }} / {{ stats.frameTimeMax }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Ticks/sec</span>
            <span class="stat-value">{{ stats.ticksPerSec }}</span>
          </div>
        </div>
      </section>

      <!-- Entities -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.entities = !sections.entities">
          <span class="caret">{{ sections.entities ? '&#x25BC;' : '&#x25B6;' }}</span>
          Entities
        </h3>
        <div v-if="sections.entities" class="section-body">
          <div class="stat-row">
            <span class="stat-label">Total</span>
            <span class="stat-value">{{ stats.entityCount }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Buildings</span>
            <span class="stat-value">{{ stats.buildingCount }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Units</span>
            <span class="stat-value">{{ stats.unitCount }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Moving</span>
            <span class="stat-value">{{ stats.unitsMoving }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Path steps</span>
            <span class="stat-value">{{ stats.totalPathSteps }}</span>
          </div>
        </div>
      </section>

      <!-- Camera -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.camera = !sections.camera">
          <span class="caret">{{ sections.camera ? '&#x25BC;' : '&#x25B6;' }}</span>
          Camera
        </h3>
        <div v-if="sections.camera" class="section-body">
          <div class="stat-row">
            <span class="stat-label">Position</span>
            <span class="stat-value">{{ stats.cameraX }}, {{ stats.cameraY }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Zoom</span>
            <span class="stat-value">{{ stats.zoom }}x</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Canvas</span>
            <span class="stat-value">{{ stats.canvasWidth }} x {{ stats.canvasHeight }}</span>
          </div>
        </div>
      </section>

      <!-- Tile -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.tile = !sections.tile">
          <span class="caret">{{ sections.tile ? '&#x25BC;' : '&#x25B6;' }}</span>
          Tile
        </h3>
        <div v-if="sections.tile" class="section-body">
          <template v-if="stats.hasTile">
            <div class="stat-row">
              <span class="stat-label">Coords</span>
              <span class="stat-value">{{ stats.tileX }}, {{ stats.tileY }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Ground type</span>
              <span class="stat-value">{{ stats.tileGroundType }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Height</span>
              <span class="stat-value">{{ stats.tileGroundHeight }}</span>
            </div>
          </template>
          <div v-else class="stat-row">
            <span class="stat-label dim">Move mouse over map</span>
          </div>
        </div>
      </section>

      <!-- Controls -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.controls = !sections.controls">
          <span class="caret">{{ sections.controls ? '&#x25BC;' : '&#x25B6;' }}</span>
          Controls
        </h3>
        <div v-if="sections.controls" class="section-body">
          <label class="control-row">
            <input type="checkbox" :checked="debugGrid" @change="$emit('update:debugGrid', ($event.target as HTMLInputElement).checked)" />
            <span>Debug grid</span>
          </label>
          <label class="control-row">
            <input type="checkbox" :checked="showTerritoryBorders" @change="$emit('update:showTerritoryBorders', ($event.target as HTMLInputElement).checked)" />
            <span>Territory borders</span>
          </label>
          <div class="control-buttons">
            <button class="ctrl-btn" @click="$emit('togglePause')">
              {{ paused ? 'Resume' : 'Pause' }}
            </button>
          </div>
          <div class="river-debug">
            <span class="stat-label" style="margin-top:6px;display:block">River textures</span>
            <label class="control-row">
              <input type="checkbox" :checked="stats.riverSwapRows" @change="setRiver('riverSwapRows', $event)" />
              <span>Swap rows</span>
            </label>
            <label class="control-row">
              <input type="checkbox" :checked="stats.riverReverseInner" @change="setRiver('riverReverseInner', $event)" />
              <span>Reverse inner</span>
            </label>
            <label class="control-row">
              <input type="checkbox" :checked="stats.riverReverseOuter" @change="setRiver('riverReverseOuter', $event)" />
              <span>Reverse outer</span>
            </label>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { debugStats } from '@/game/debug-stats';

defineProps<{
    debugGrid: boolean;
    showTerritoryBorders: boolean;
    paused: boolean;
}>();

defineEmits<{
    (e: 'update:debugGrid', value: boolean): void;
    (e: 'update:showTerritoryBorders', value: boolean): void;
    (e: 'togglePause'): void;
}>();

const open = ref(false);
const sections = reactive({
    perf: true,
    entities: true,
    camera: true,
    tile: true,
    controls: true,
});

const stats = debugStats.state;

function setRiver(key: 'riverSwapRows' | 'riverReverseInner' | 'riverReverseOuter', e: Event) {
    stats[key] = (e.target as HTMLInputElement).checked;
    const lr = (window as any).__settlers_landscape__;
    if (lr) {
        lr.rebuildRiverTextures({
            swapRows: stats.riverSwapRows,
            reverseInner: stats.riverReverseInner,
            reverseOuter: stats.riverReverseOuter,
        });
    }
}

const fpsClass = computed(() => {
    if (stats.fps >= 55) return 'fps-good';
    if (stats.fps >= 30) return 'fps-ok';
    return 'fps-bad';
});
</script>

<style scoped>
.debug-panel {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 100;
  background: rgba(13, 10, 5, 0.92);
  border: 1px solid #5c3d1a;
  border-radius: 4px;
  color: #c8a96e;
  font-size: 11px;
  font-family: monospace;
  min-width: 200px;
  max-height: calc(100% - 16px);
  overflow-y: auto;
  pointer-events: auto;
}

.debug-panel.collapsed {
  min-width: 0;
}

.debug-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: #2c1e0e;
  color: #d4b27a;
  border: none;
  border-bottom: 1px solid #3a2a10;
  cursor: pointer;
  font-size: 11px;
  font-family: monospace;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.debug-toggle-btn:hover {
  background: #3a2810;
}

.toggle-icon {
  font-size: 8px;
  width: 10px;
}

.fps-badge {
  margin-left: auto;
  padding: 1px 5px;
  background: #1a2a1a;
  border: 1px solid #2a4a2a;
  border-radius: 2px;
  color: #80c080;
  font-weight: normal;
  font-size: 10px;
}

.debug-sections {
  padding: 2px 0;
}

.debug-section {
  border-bottom: 1px solid #2a1e0e;
}

.debug-section:last-child {
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  margin: 0;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8a7040;
  cursor: pointer;
  user-select: none;
}

.section-header:hover {
  color: #c8a96e;
  background: rgba(60, 40, 16, 0.3);
}

.caret {
  font-size: 7px;
  width: 10px;
}

.section-body {
  padding: 2px 10px 6px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 1px 0;
  gap: 12px;
}

.stat-label {
  color: #7a6a4a;
}

.stat-label.dim {
  color: #4a3a2a;
  font-style: italic;
}

.stat-value {
  color: #d4b27a;
  text-align: right;
}

.fps-good { color: #80c080; }
.fps-ok { color: #d4a030; }
.fps-bad { color: #d04040; }

.control-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  cursor: pointer;
  color: #a08050;
}

.control-row:hover {
  color: #c8a96e;
}

.control-row input[type="checkbox"] {
  accent-color: #d4a030;
}

.control-buttons {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.ctrl-btn {
  flex: 1;
  padding: 4px 8px;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  font-family: monospace;
  font-weight: bold;
  text-transform: uppercase;
}

.ctrl-btn:hover {
  background: #3a2810;
  border-color: #6a4a20;
}

/* Scrollbar */
.debug-panel::-webkit-scrollbar {
  width: 4px;
}

.debug-panel::-webkit-scrollbar-track {
  background: #0d0a05;
}

.debug-panel::-webkit-scrollbar-thumb {
  background: #4a3218;
  border-radius: 2px;
}
</style>

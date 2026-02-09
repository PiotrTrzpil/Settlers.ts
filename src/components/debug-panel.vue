<template>
  <div class="debug-panel" :class="{ collapsed: !open }">
    <button class="debug-toggle-btn" @click="open = !open" title="Debug Panel">
      <span class="toggle-icon">{{ open ? '&#x25BC;' : '&#x25B6;' }}</span>
      <span class="toggle-label">Debug</span>
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

      <!-- Load Timings -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.loadTimings = !sections.loadTimings">
          <span class="caret">{{ sections.loadTimings ? '&#x25BC;' : '&#x25B6;' }}</span>
          Load Timings
        </h3>
        <div v-if="sections.loadTimings" class="section-body">
          <div class="stat-row">
            <span class="stat-label">Landscape</span>
            <span class="stat-value">{{ stats.loadTimings.landscape }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">File preload</span>
            <span class="stat-value">{{ stats.loadTimings.filePreload }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Atlas alloc</span>
            <span class="stat-value">{{ stats.loadTimings.atlasAlloc }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Buildings</span>
            <span class="stat-value">{{ stats.loadTimings.buildings }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Map objects</span>
            <span class="stat-value">{{ stats.loadTimings.mapObjects }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Resources</span>
            <span class="stat-value">{{ stats.loadTimings.resources }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Units</span>
            <span class="stat-value">{{ stats.loadTimings.units }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">GPU upload</span>
            <span class="stat-value">{{ stats.loadTimings.gpuUpload }} ms</span>
          </div>
          <div class="stat-row total-row">
            <span class="stat-label">Total sprites</span>
            <span class="stat-value">{{ stats.loadTimings.totalSprites }} ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Atlas size</span>
            <span class="stat-value">{{ stats.loadTimings.atlasSize || '-' }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Sprite count</span>
            <span class="stat-value">{{ stats.loadTimings.spriteCount }}</span>
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
          <div class="control-buttons">
            <button class="ctrl-btn" @click="$emit('togglePause')">
              {{ paused ? 'Resume' : 'Pause' }}
            </button>
          </div>
          <div class="river-debug">
            <span class="stat-label river-heading">River textures</span>
            <div class="stat-row">
              <span class="stat-label">Slots (I/O/M)</span>
              <span class="perm-control">
                <button class="perm-btn" @click="cycleSlotPerm(-1)">&lt;</button>
                <span class="perm-value">{{ slotPermLabel }}</span>
                <button class="perm-btn" @click="cycleSlotPerm(1)">&gt;</button>
              </span>
            </div>
            <label class="control-row">
              <input type="checkbox" :checked="stats.riverFlipInner" @change="setRiverFlip('riverFlipInner', $event)" />
              <span>Flip inner (River3&#x2194;River1)</span>
            </label>
            <label class="control-row">
              <input type="checkbox" :checked="stats.riverFlipOuter" @change="setRiverFlip('riverFlipOuter', $event)" />
              <span>Flip outer (Grass&#x2194;River4)</span>
            </label>
            <label class="control-row">
              <input type="checkbox" :checked="stats.riverFlipMiddle" @change="setRiverFlip('riverFlipMiddle', $event)" />
              <span>Flip middle (River4&#x2194;River3)</span>
            </label>
            <div class="stat-row">
              <span class="stat-label dim">{{ configIndex }}/48</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Map Objects -->
      <section class="debug-section">
        <h3 class="section-header" @click="sections.mapObjects = !sections.mapObjects">
          <span class="caret">{{ sections.mapObjects ? '&#x25BC;' : '&#x25B6;' }}</span>
          Map Objects
        </h3>
        <div v-if="sections.mapObjects" class="section-body">
          <div class="map-obj-row">
            <span class="stat-label">Trees</span>
            <span class="stat-value">{{ mapObjectCounts.trees }}</span>
            <button class="spawn-btn" @click="spawnCategory('trees')">+</button>
          </div>
          <div class="map-obj-row">
            <span class="stat-label">Stones</span>
            <span class="stat-value">{{ mapObjectCounts.stones }}</span>
            <button class="spawn-btn" @click="spawnCategory('stones')">+</button>
          </div>
          <div class="map-obj-row">
            <span class="stat-label">Resources</span>
            <span class="stat-value">{{ mapObjectCounts.resources }}</span>
            <button class="spawn-btn" @click="spawnCategory('resources')">+</button>
          </div>
          <div class="map-obj-row">
            <span class="stat-label">Plants</span>
            <span class="stat-value">{{ mapObjectCounts.plants }}</span>
            <button class="spawn-btn" @click="spawnCategory('plants')">+</button>
          </div>
          <div class="map-obj-actions">
            <button class="ctrl-btn" @click="spawnAllFromMap()">From Map</button>
            <button class="ctrl-btn" @click="clearAllMapObjects()">Clear</button>
          </div>
          <div v-if="!hasObjectTypeData" class="stat-row">
            <span class="stat-label dim">No map object data (test map)</span>
          </div>
        </div>
      </section>

    </div>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable max-lines */
import { reactive, computed } from 'vue';
import { debugStats } from '@/game/debug-stats';
import { RIVER_SLOT_PERMS } from '@/game/renderer/landscape/textures/landscape-texture-map';
import type { Game } from '@/game/game';
import { useDebugMapObjects } from './use-debug-map-objects';

const props = defineProps<{
    paused: boolean;
    currentRace: number; // Race enum
}>();

defineEmits<{
    (e: 'togglePause'): void;
}>();

const stats = debugStats.state;

// Use the persisted open state from debug stats
const open = computed({
    get: () => stats.debugPanelOpen,
    set: (value: boolean) => { stats.debugPanelOpen = value }
});

const sections = reactive({
    perf: true,
    loadTimings: false,
    entities: true,
    camera: true,
    tile: true,
    controls: true,
    mapObjects: false,
});

// Map objects functionality (extracted to composable)
const getGame = (): Game | null => (window as any).__settlers_game__ ?? null;
const {
    mapObjectCounts,
    hasObjectTypeData,
    spawnCategory,
    spawnAllFromMap,
    clearAllMapObjects,
} = useDebugMapObjects(getGame);

const slotPermLabel = computed(() => {
    const perm = RIVER_SLOT_PERMS[stats.riverSlotPermutation % RIVER_SLOT_PERMS.length];
    return perm.join('-');
});

const configIndex = computed(() => {
    return stats.riverSlotPermutation * 8
        + (stats.riverFlipInner ? 4 : 0)
        + (stats.riverFlipOuter ? 2 : 0)
        + (stats.riverFlipMiddle ? 1 : 0)
        + 1;
});

function applyRiverConfig() {
    const lr = (window as any).__settlers_landscape__;
    if (lr) {
        lr.rebuildRiverTextures({
            slotPermutation: stats.riverSlotPermutation,
            flipInner: stats.riverFlipInner,
            flipOuter: stats.riverFlipOuter,
            flipMiddle: stats.riverFlipMiddle,
        });
    }
}

function cycleSlotPerm(dir: number) {
    const len = RIVER_SLOT_PERMS.length;
    stats.riverSlotPermutation = ((stats.riverSlotPermutation + dir) % len + len) % len;
    applyRiverConfig();
}

function setRiverFlip(key: 'riverFlipInner' | 'riverFlipOuter' | 'riverFlipMiddle', e: Event) {
    stats[key] = (e.target as HTMLInputElement).checked;
    applyRiverConfig();
}

const fpsClass = computed(() => {
    if (stats.fps >= 55) return 'fps-good';
    if (stats.fps >= 30) return 'fps-ok';
    return 'fps-bad';
});
</script>

<style scoped>
.debug-panel {
  background: rgba(13, 10, 5, 0.92);
  border: 1px solid #5c3d1a;
  border-radius: 4px;
  color: #c8a96e;
  font-size: 11px;
  font-family: monospace;
  min-width: 200px;
  max-height: 100%;
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

.total-row {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #3a2a10;
  font-weight: bold;
}

.total-row .stat-value {
  color: #e0c080;
}

.slider-value {
  display: flex;
  align-items: center;
  gap: 4px;
}

.slider-value input[type="range"] {
  width: 60px;
  height: 4px;
  accent-color: #d4a030;
  cursor: pointer;
}

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

.river-heading {
  display: block;
  margin-top: 6px;
}

.perm-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.perm-btn {
  padding: 1px 6px;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 2px;
  cursor: pointer;
  font-size: 10px;
  font-family: monospace;
  line-height: 1;
}

.perm-btn:hover {
  background: #3a2810;
  border-color: #6a4a20;
}

.perm-value {
  color: #d4b27a;
  font-weight: bold;
  min-width: 36px;
  text-align: center;
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
  color: #80c080;
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

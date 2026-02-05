<template>
  <div class="layer-panel" :class="{ collapsed: !open }">
    <button class="layer-toggle-btn" @click="open = !open" title="Layer Panel">
      <span class="toggle-icon">{{ open ? '&#x25BC;' : '&#x25B6;' }}</span>
      <span class="toggle-label">Layers</span>
      <span class="layer-count-badge" v-if="!open">{{ visibleCount }}/{{ totalCount }}</span>
    </button>

    <div v-if="open" class="layer-sections">
      <!-- Main layers -->
      <section class="layer-section">
        <h3 class="section-header" @click="sections.main = !sections.main">
          <span class="caret">{{ sections.main ? '&#x25BC;' : '&#x25B6;' }}</span>
          Main Layers
        </h3>
        <div v-if="sections.main" class="section-body">
          <!-- Buildings -->
          <label class="layer-row">
            <input
              type="checkbox"
              :checked="visibility.buildings"
              @change="updateLayer('buildings', ($event.target as HTMLInputElement).checked)"
            />
            <span class="layer-icon building-icon"></span>
            <span>Buildings</span>
          </label>

          <!-- Units -->
          <label class="layer-row">
            <input
              type="checkbox"
              :checked="visibility.units"
              @change="updateLayer('units', ($event.target as HTMLInputElement).checked)"
            />
            <span class="layer-icon unit-icon"></span>
            <span>Units</span>
          </label>

          <!-- Resources -->
          <label class="layer-row">
            <input
              type="checkbox"
              :checked="visibility.resources"
              @change="updateLayer('resources', ($event.target as HTMLInputElement).checked)"
            />
            <span class="layer-icon resource-icon"></span>
            <span>Resources</span>
          </label>
        </div>
      </section>

      <!-- Environment (expandable with sub-layers) -->
      <section class="layer-section">
        <h3 class="section-header" @click="sections.environment = !sections.environment">
          <span class="caret">{{ sections.environment ? '&#x25BC;' : '&#x25B6;' }}</span>
          Environment
          <span class="env-status" :class="{ partial: isEnvironmentPartial }">
            {{ environmentStatusText }}
          </span>
        </h3>
        <div v-if="sections.environment" class="section-body">
          <!-- Environment master toggle -->
          <label class="layer-row master-toggle">
            <input
              type="checkbox"
              :checked="visibility.environment"
              :indeterminate="isEnvironmentPartial"
              @change="toggleEnvironmentMaster(($event.target as HTMLInputElement).checked)"
            />
            <span class="layer-icon env-icon"></span>
            <span>All Environment</span>
          </label>

          <!-- Sub-layers (indented) -->
          <div class="sub-layers" :class="{ disabled: !visibility.environment }">
            <label class="layer-row sub-layer">
              <input
                type="checkbox"
                :checked="visibility.environmentLayers.trees"
                :disabled="!visibility.environment"
                @change="updateSubLayer('trees', ($event.target as HTMLInputElement).checked)"
              />
              <span class="layer-icon tree-icon"></span>
              <span>Trees</span>
            </label>

            <label class="layer-row sub-layer">
              <input
                type="checkbox"
                :checked="visibility.environmentLayers.stones"
                :disabled="!visibility.environment"
                @change="updateSubLayer('stones', ($event.target as HTMLInputElement).checked)"
              />
              <span class="layer-icon stone-icon"></span>
              <span>Stones</span>
            </label>

            <label class="layer-row sub-layer">
              <input
                type="checkbox"
                :checked="visibility.environmentLayers.plants"
                :disabled="!visibility.environment"
                @change="updateSubLayer('plants', ($event.target as HTMLInputElement).checked)"
              />
              <span class="layer-icon plant-icon"></span>
              <span>Plants</span>
            </label>

            <label class="layer-row sub-layer">
              <input
                type="checkbox"
                :checked="visibility.environmentLayers.other"
                :disabled="!visibility.environment"
                @change="updateSubLayer('other', ($event.target as HTMLInputElement).checked)"
              />
              <span class="layer-icon other-icon"></span>
              <span>Other</span>
            </label>
          </div>
        </div>
      </section>

      <!-- Quick actions -->
      <section class="layer-section">
        <div class="quick-actions">
          <button class="action-btn" @click="showAll" title="Show all layers">
            Show All
          </button>
          <button class="action-btn" @click="hideAll" title="Hide all layers">
            Hide All
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue';
import {
    LayerVisibility,
    loadLayerVisibility,
    saveLayerVisibility,
} from '@/game/renderer/layer-visibility';
import { debugStats } from '@/game/debug-stats';

const emit = defineEmits<{
    (e: 'update:visibility', value: LayerVisibility): void;
}>();

// Use the persisted open state from debug stats
const open = computed({
    get: () => debugStats.state.layerPanelOpen,
    set: (value: boolean) => { debugStats.state.layerPanelOpen = value; }
});

// Section expansion state (local, not persisted)
const sections = reactive({
    main: true,
    environment: true,
});

// Layer visibility state
const visibility = reactive<LayerVisibility>(loadLayerVisibility());

// Computed values
const totalCount = 4; // Buildings, Units, Resources, Environment

const visibleCount = computed(() => {
    let count = 0;
    if (visibility.buildings) count++;
    if (visibility.units) count++;
    if (visibility.resources) count++;
    if (visibility.environment) count++;
    return count;
});

const isEnvironmentPartial = computed(() => {
    if (!visibility.environment) return false;
    const layers = visibility.environmentLayers;
    const allTrue = layers.trees && layers.stones && layers.plants && layers.other;
    const allFalse = !layers.trees && !layers.stones && !layers.plants && !layers.other;
    return !allTrue && !allFalse;
});

const environmentStatusText = computed(() => {
    if (!visibility.environment) return 'off';
    const layers = visibility.environmentLayers;
    const count = [layers.trees, layers.stones, layers.plants, layers.other].filter(Boolean).length;
    if (count === 4) return 'all';
    if (count === 0) return 'none';
    return `${count}/4`;
});

// Methods
function updateLayer(layer: 'buildings' | 'units' | 'resources', value: boolean): void {
    visibility[layer] = value;
    saveAndEmit();
}

function updateSubLayer(subLayer: 'trees' | 'stones' | 'plants' | 'other', value: boolean): void {
    visibility.environmentLayers[subLayer] = value;
    saveAndEmit();
}

function toggleEnvironmentMaster(value: boolean): void {
    visibility.environment = value;
    if (value) {
        // If turning on, enable all sub-layers
        visibility.environmentLayers.trees = true;
        visibility.environmentLayers.stones = true;
        visibility.environmentLayers.plants = true;
        visibility.environmentLayers.other = true;
    }
    saveAndEmit();
}

function showAll(): void {
    visibility.buildings = true;
    visibility.units = true;
    visibility.resources = true;
    visibility.environment = true;
    visibility.environmentLayers.trees = true;
    visibility.environmentLayers.stones = true;
    visibility.environmentLayers.plants = true;
    visibility.environmentLayers.other = true;
    saveAndEmit();
}

function hideAll(): void {
    visibility.buildings = false;
    visibility.units = false;
    visibility.resources = false;
    visibility.environment = false;
    saveAndEmit();
}

function saveAndEmit(): void {
    saveLayerVisibility(visibility);
    emit('update:visibility', { ...visibility, environmentLayers: { ...visibility.environmentLayers } });
}

// Emit initial state
emit('update:visibility', { ...visibility, environmentLayers: { ...visibility.environmentLayers } });
</script>

<style scoped>
.layer-panel {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 100;
  background: rgba(13, 10, 5, 0.92);
  border: 1px solid #5c3d1a;
  border-radius: 4px;
  color: #c8a96e;
  font-size: 11px;
  font-family: monospace;
  min-width: 160px;
  max-height: calc(100% - 16px);
  overflow-y: auto;
  pointer-events: auto;
}

.layer-panel.collapsed {
  min-width: 0;
}

.layer-toggle-btn {
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

.layer-toggle-btn:hover {
  background: #3a2810;
}

.toggle-icon {
  font-size: 8px;
  width: 10px;
}

.layer-count-badge {
  margin-left: auto;
  padding: 1px 5px;
  background: #1a2a1a;
  border: 1px solid #2a4a2a;
  border-radius: 2px;
  color: #80c080;
  font-weight: normal;
  font-size: 10px;
}

.layer-sections {
  padding: 2px 0;
}

.layer-section {
  border-bottom: 1px solid #2a1e0e;
}

.layer-section:last-child {
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

.env-status {
  margin-left: auto;
  padding: 1px 4px;
  background: #1a2a1a;
  border: 1px solid #2a4a2a;
  border-radius: 2px;
  color: #80c080;
  font-size: 9px;
  font-weight: normal;
  text-transform: none;
}

.env-status.partial {
  background: #2a2a1a;
  border-color: #4a4a2a;
  color: #c0c080;
}

.section-body {
  padding: 2px 10px 6px;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  cursor: pointer;
  color: #a08050;
  transition: color 0.15s;
}

.layer-row:hover {
  color: #c8a96e;
}

.layer-row input[type="checkbox"] {
  accent-color: #d4a030;
  cursor: pointer;
}

.layer-row input[type="checkbox"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.master-toggle {
  font-weight: bold;
  color: #b09060;
  border-bottom: 1px solid #2a1e0e;
  padding-bottom: 5px;
  margin-bottom: 2px;
}

.sub-layers {
  padding-left: 8px;
  border-left: 2px solid #3a2a10;
  margin-left: 4px;
}

.sub-layers.disabled {
  opacity: 0.5;
}

.sub-layer {
  font-size: 10px;
}

/* Layer icons (colored dots) */
.layer-icon {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.building-icon {
  background: linear-gradient(135deg, #8b6914 0%, #5c4a0f 100%);
  border: 1px solid #a07a1a;
}

.unit-icon {
  background: linear-gradient(135deg, #4a90d0 0%, #2a60a0 100%);
  border: 1px solid #5aa0e0;
}

.resource-icon {
  background: linear-gradient(135deg, #d4a030 0%, #a07820 100%);
  border: 1px solid #e4b040;
}

.env-icon {
  background: linear-gradient(135deg, #3a8030 0%, #2a6020 100%);
  border: 1px solid #4a9040;
}

.tree-icon {
  background: linear-gradient(135deg, #2a6020 0%, #1a4010 100%);
  border: 1px solid #3a7030;
}

.stone-icon {
  background: linear-gradient(135deg, #707070 0%, #505050 100%);
  border: 1px solid #808080;
}

.plant-icon {
  background: linear-gradient(135deg, #80b060 0%, #608040 100%);
  border: 1px solid #90c070;
}

.other-icon {
  background: linear-gradient(135deg, #6a5030 0%, #4a3020 100%);
  border: 1px solid #7a6040;
}

/* Quick actions */
.quick-actions {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
}

.action-btn {
  flex: 1;
  padding: 4px 6px;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  cursor: pointer;
  font-size: 9px;
  font-family: monospace;
  font-weight: bold;
  text-transform: uppercase;
  transition: background 0.15s, border-color 0.15s;
}

.action-btn:hover {
  background: #3a2810;
  border-color: #6a4a20;
}

/* Scrollbar */
.layer-panel::-webkit-scrollbar {
  width: 4px;
}

.layer-panel::-webkit-scrollbar-track {
  background: #0d0a05;
}

.layer-panel::-webkit-scrollbar-thumb {
  background: #4a3218;
  border-radius: 2px;
}
</style>

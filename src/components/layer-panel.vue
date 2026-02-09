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
          <LayerCheckbox
            v-model="visibility.buildings"
            label="Buildings"
            emoji="🏠"
            :count="props.counts?.buildings"
            @update:modelValue="saveAndEmit()"
          />
          <LayerCheckbox
            v-model="visibility.units"
            label="Units"
            emoji="👷"
            :count="props.counts?.units"
            @update:modelValue="saveAndEmit()"
          />
          <LayerCheckbox
            v-model="visibility.resources"
            label="Resources"
            emoji="💎"
            :count="props.counts?.resources"
            @update:modelValue="saveAndEmit()"
          />
        </div>
      </section>

      <!-- Environment (expandable with sub-layers) -->
      <section class="layer-section">
        <h3 class="section-header" @click="sections.environment = !sections.environment">
          <span class="caret">{{ sections.environment ? '&#x25BC;' : '&#x25B6;' }}</span>
          🌳 Environment
          <span class="env-status" :class="{ partial: isEnvironmentPartial }">
            {{ environmentStatusText }}
          </span>
          <span class="layer-count header-count" v-if="props.counts">{{ props.counts.environment }}</span>
        </h3>
        <div v-if="sections.environment" class="section-body">
          <LayerCheckbox
            v-model="visibility.environment"
            label="All Environment"
            emoji="🌍"
            :count="props.counts?.environment"
            :indeterminate="isEnvironmentPartial"
            master
            @update:modelValue="onEnvironmentMasterChange"
          />

          <div class="sub-layers" :class="{ disabled: !visibility.environment }">
            <LayerCheckbox
              v-model="visibility.environmentLayers.trees"
              label="Trees"
              emoji="🌲"
              :count="props.counts?.trees"
              :disabled="!visibility.environment"
              sub
              @update:modelValue="saveAndEmit()"
            />
            <LayerCheckbox
              v-model="visibility.environmentLayers.stones"
              label="Stones"
              emoji="🪨"
              :count="props.counts?.stones"
              :disabled="!visibility.environment"
              sub
              @update:modelValue="saveAndEmit()"
            />
            <LayerCheckbox
              v-model="visibility.environmentLayers.plants"
              label="Plants"
              emoji="🌿"
              :count="props.counts?.plants"
              :disabled="!visibility.environment"
              sub
              @update:modelValue="saveAndEmit()"
            />
            <LayerCheckbox
              v-model="visibility.environmentLayers.other"
              label="Other"
              emoji="📦"
              :count="props.counts?.other"
              :disabled="!visibility.environment"
              sub
              @update:modelValue="saveAndEmit()"
            />
          </div>
        </div>
      </section>

      <!-- Quick actions -->
      <section class="layer-section">
        <div class="quick-actions">
          <SettingsButton @click="showAll" title="Show all layers">Show All</SettingsButton>
          <SettingsButton @click="hideAll" title="Hide all layers">Hide All</SettingsButton>
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
import type { LayerCounts } from '@/views/use-map-view';
import LayerCheckbox from './LayerCheckbox.vue';
import SettingsButton from './settings/SettingsButton.vue';

const props = defineProps<{
    counts?: LayerCounts;
}>();

const emit = defineEmits<{
    (e: 'update:visibility', value: LayerVisibility): void;
}>();

// Use the persisted open state from debug stats
const open = computed({
    get: () => debugStats.state.layerPanelOpen,
    set: (value: boolean) => { debugStats.state.layerPanelOpen = value }
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
function onEnvironmentMasterChange(value: boolean): void {
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
  background: rgba(13, 10, 5, 0.92);
  border: 1px solid #5c3d1a;
  border-radius: 4px;
  color: #c8a96e;
  font-size: 11px;
  font-family: monospace;
  min-width: 160px;
  max-height: 100%;
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

.header-count {
  margin-left: 4px;
  padding: 1px 5px;
  background: #1a1a2a;
  border: 1px solid #2a2a4a;
  border-radius: 2px;
  color: #8080c0;
  font-size: 9px;
  min-width: 20px;
  text-align: center;
}

.sub-layers {
  padding-left: 8px;
  border-left: 2px solid #3a2a10;
  margin-left: 4px;
}

.sub-layers.disabled {
  opacity: 0.5;
}

/* Quick actions */
.quick-actions {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
}

.quick-actions :deep(button) {
  flex: 1;
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

<template>
    <OverlayPanel v-model:open="open" label="Layers" title="Layer Panel" min-width="160px">
        <template #toggle-extra>
            <Badge v-if="!open" color="success">{{ visibleCount }}/{{ totalCount }}</Badge>
        </template>
        <CollapseSection title="Main Layers">
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
        </CollapseSection>

        <CollapseSection>
            <template #title>🌳 Environment</template>
            <template #title-extra>
                <Badge :color="envBadgeColor">{{ environmentStatusText }}</Badge>
                <Badge v-if="props.counts" color="info">{{ props.counts.environment }}</Badge>
            </template>

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

            <!-- Object type filter -->
            <div class="obj-filter">
                <label class="filter-row">
                    <input
                        type="checkbox"
                        :checked="visibility.debugObjectTypeFilter !== null"
                        @change="toggleObjectFilter"
                    />
                    <span>Filter by type</span>
                </label>
                <div v-if="visibility.debugObjectTypeFilter !== null" class="filter-controls">
                    <button class="filter-btn" @click="changeObjectFilter(-1)">&minus;</button>
                    <input
                        type="number"
                        class="filter-input"
                        :value="visibility.debugObjectTypeFilter"
                        min="1"
                        max="255"
                        @input="onFilterInput"
                    />
                    <button class="filter-btn" @click="changeObjectFilter(1)">+</button>
                </div>
                <div v-if="visibility.debugObjectTypeFilter !== null" class="filter-info">
                    {{ objectFilterLabel }}
                </div>
            </div>
        </CollapseSection>

        <!-- Quick actions -->
        <section class="quick-actions-section">
            <div class="quick-actions">
                <SettingsButton @click="showAll" title="Show all layers">Show All</SettingsButton>
                <SettingsButton @click="hideAll" title="Hide all layers">Hide All</SettingsButton>
            </div>
        </section>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue';
import { LayerVisibility, loadLayerVisibility, saveLayerVisibility } from '@/game/renderer/layer-visibility';
import { debugStats } from '@/game/debug-stats';
import type { LayerCounts } from '@/views/use-map-view';
import LayerCheckbox from './LayerCheckbox.vue';
import SettingsButton from './settings/SettingsButton.vue';
import CollapseSection from './CollapseSection.vue';
import OverlayPanel from './OverlayPanel.vue';
import Badge from './Badge.vue';

const props = defineProps<{
    counts?: LayerCounts;
}>();

const emit = defineEmits<{
    (e: 'update:visibility', value: LayerVisibility): void;
}>();

// Use the persisted open state from debug stats
const open = computed({
    get: () => debugStats.state.layerPanelOpen,
    set: (value: boolean) => {
        debugStats.state.layerPanelOpen = value;
    },
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

const envBadgeColor = computed(() => {
    if (!visibility.environment) return 'neutral' as const;
    if (isEnvironmentPartial.value) return 'warn' as const;
    return 'success' as const;
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

// Object type filter
const objectFilterLabel = computed(() => {
    const t = visibility.debugObjectTypeFilter;
    if (t === null) return '';
    if (t >= 1 && t <= 18) return `Tree type ${t}`;
    return `Raw type ${t}`;
});

function toggleObjectFilter(e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    visibility.debugObjectTypeFilter = checked ? 1 : null;
    saveAndEmit();
}

function changeObjectFilter(delta: number): void {
    const current = visibility.debugObjectTypeFilter ?? 1;
    visibility.debugObjectTypeFilter = Math.max(1, Math.min(255, current + delta));
    saveAndEmit();
}

function onFilterInput(e: Event): void {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 1 && val <= 255) {
        visibility.debugObjectTypeFilter = val;
        saveAndEmit();
    }
}

function saveAndEmit(): void {
    saveLayerVisibility(visibility);
    emit('update:visibility', { ...visibility, environmentLayers: { ...visibility.environmentLayers } });
}

// Emit initial state
emit('update:visibility', { ...visibility, environmentLayers: { ...visibility.environmentLayers } });
</script>

<style scoped>
.sub-layers {
    padding-left: 8px;
    border-left: 2px solid var(--border);
    margin-left: 4px;
}

.sub-layers.disabled {
    opacity: 0.5;
}

/* Quick actions */
.quick-actions-section {
    border-top: 1px solid var(--border-faint);
}

.quick-actions {
    display: flex;
    gap: 4px;
    padding: 6px 10px;
}

.quick-actions :deep(button) {
    flex: 1;
}

/* Object type filter */
.obj-filter {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-faint, #2a1e0e);
}

.filter-row {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: #a08050;
    font-size: 10px;
}

.filter-row input[type='checkbox'] {
    accent-color: #d4a030;
    cursor: pointer;
}

.filter-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
}

.filter-btn {
    width: 22px;
    height: 22px;
    background: #1a1a2a;
    border: 1px solid #3a3a5a;
    border-radius: 3px;
    color: #c8a96e;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}

.filter-btn:hover {
    background: #2a2a4a;
    border-color: #d4a030;
}

.filter-input {
    width: 48px;
    height: 22px;
    background: #0a0a1a;
    border: 1px solid #3a3a5a;
    border-radius: 3px;
    color: #c8a96e;
    text-align: center;
    font-size: 11px;
    -moz-appearance: textfield;
}

.filter-input::-webkit-inner-spin-button,
.filter-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.filter-info {
    margin-top: 3px;
    font-size: 9px;
    color: #8080a0;
}
</style>

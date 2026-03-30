<template>
    <OverlayPanel label="Layers" title="Layer Panel" min-width="160px" persist-key="layers">
        <template #toggle-extra>
            <Badge v-if="!open" color="success">{{ visibleCount }}/{{ totalCount }}</Badge>
        </template>
        <CollapseSection title="Landscape" :default-open="false" persist-key="layer-landscape">
            <div class="river-debug">
                <span class="river-heading stat-label">River textures</span>
                <StatRow label="Slots (I/O/M)">
                    <span class="perm-control">
                        <button class="perm-btn" @click="cycleSlotPerm(-1)">&lt;</button>
                        <span class="perm-value">{{ slotPermLabel }}</span>
                        <button class="perm-btn" @click="cycleSlotPerm(1)">&gt;</button>
                    </span>
                </StatRow>
                <Checkbox
                    v-model="stats.riverFlipInner"
                    label="Flip inner (River3↔River1)"
                    @update:modelValue="applyRiverConfig()"
                />
                <Checkbox
                    v-model="stats.riverFlipOuter"
                    label="Flip outer (Grass↔River4)"
                    @update:modelValue="applyRiverConfig()"
                />
                <Checkbox
                    v-model="stats.riverFlipMiddle"
                    label="Flip middle (River4↔River3)"
                    @update:modelValue="applyRiverConfig()"
                />
                <StatRow label="" dim :value="`${configIndex}/48`" />
            </div>
        </CollapseSection>

        <CollapseSection title="Main Layers" persist-key="layer-main">
            <LayerCheckbox
                v-model="visibility.buildings"
                label="Buildings"
                emoji="🏠"
                :count="props.counts?.buildings"
                @update:modelValue="saveAndEmit()"
            />
            <div class="sub-layers" :class="{ disabled: !visibility.buildings }">
                <LayerCheckbox
                    v-model="visibility.showBuildingFootprint"
                    label="Footprints"
                    emoji="👣"
                    :disabled="!visibility.buildings"
                    sub
                    @update:modelValue="saveAndEmit()"
                />
            </div>
            <LayerCheckbox
                v-model="visibility.units"
                label="Units"
                emoji="👷"
                :count="props.counts?.units"
                @update:modelValue="saveAndEmit()"
            />
            <div class="sub-layers" :class="{ disabled: !visibility.units }">
                <LayerCheckbox
                    v-model="visibility.showPathfinding"
                    label="Pathfinding"
                    emoji="🔍"
                    :disabled="!visibility.units"
                    sub
                    @update:modelValue="saveAndEmit()"
                />
            </div>
            <LayerCheckbox
                v-model="visibility.piles"
                label="Resources"
                emoji="💎"
                :count="props.counts?.piles"
                @update:modelValue="saveAndEmit()"
            />
            <LayerCheckbox
                v-model="visibility.showTerritory"
                label="Territory"
                emoji="🏰"
                @update:modelValue="saveAndEmit()"
            />
        </CollapseSection>

        <CollapseSection persist-key="layer-environment">
            <template #title>🌳 Environment</template>
            <template #title-extra>
                <Badge :color="envBadgeColor">{{ environmentStatusText }}</Badge>
                <Badge v-if="props.counts" color="info">{{ props.counts.environment }}</Badge>
            </template>

            <LayerCheckbox
                v-model="visibility.decorationTextures"
                label="Textures"
                emoji="🖼️"
                @update:modelValue="saveAndEmit()"
            />

            <LayerCheckbox
                v-model="visibility.showDecoLabels"
                label="Object Labels"
                emoji="🏷️"
                @update:modelValue="saveAndEmit()"
            />

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
                <div class="other-options" :class="{ disabled: !otherEnabled }">
                    <!-- Object type filter -->
                    <div class="obj-filter">
                        <label class="filter-row">
                            <input
                                type="checkbox"
                                :checked="visibility.debugObjectTypeFilter !== null"
                                :disabled="!otherEnabled"
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
import type { LayerVisibility } from '@/game/renderer/layer-visibility';
import type { LayerCounts } from '@/views/use-map-view';
import { usePersistedRef } from '@/composables/use-persisted-ref';
import LayerCheckbox from './LayerCheckbox.vue';
import Checkbox from './Checkbox.vue';
import StatRow from './StatRow.vue';
import SettingsButton from './settings/SettingsButton.vue';
import CollapseSection from './CollapseSection.vue';
import OverlayPanel from './OverlayPanel.vue';
import Badge from './Badge.vue';
import { useLayerPanel } from '@/composables/useLayerPanel';

const props = defineProps<{
    counts?: LayerCounts;
}>();

const emit = defineEmits<{
    (e: 'update:visibility', value: LayerVisibility): void;
}>();

// Read the same persisted ref that OverlayPanel uses for its open state
const open = usePersistedRef('panel:layers', true);

const {
    visibility,
    stats,
    slotPermLabel,
    configIndex,
    otherEnabled,
    visibleCount,
    totalCount,
    isEnvironmentPartial,
    envBadgeColor,
    environmentStatusText,
    objectFilterLabel,
    applyRiverConfig,
    cycleSlotPerm,
    onEnvironmentMasterChange,
    showAll,
    hideAll,
    toggleObjectFilter,
    changeObjectFilter,
    onFilterInput,
    saveAndEmit,
} = useLayerPanel(value => emit('update:visibility', value));

// Emit initial state
emit('update:visibility', { ...visibility, environmentLayers: { ...visibility.environmentLayers } });
</script>

<style scoped>
/* River texture debug */
.river-debug {
    margin-top: 2px;
}

.river-heading {
    display: block;
    margin-bottom: 4px;
}

.stat-label {
    color: var(--text-muted);
}

.perm-control {
    display: flex;
    align-items: center;
    gap: 4px;
}

.perm-btn {
    padding: 1px 6px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 2px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    line-height: 1;
}

.perm-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.perm-value {
    color: var(--text-bright);
    font-weight: bold;
    min-width: 36px;
    text-align: center;
}

.sub-layers {
    padding-left: 8px;
    border-left: 2px solid var(--border);
    margin-left: 4px;
}

.sub-layers.disabled {
    opacity: 0.5;
}

.other-options {
    padding-left: 12px;
    border-left: 2px solid var(--border-faint, #2a1e0e);
    margin-left: 8px;
}

.other-options.disabled {
    opacity: 0.4;
    pointer-events: none;
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

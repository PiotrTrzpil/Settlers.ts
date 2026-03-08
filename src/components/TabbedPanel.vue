<template>
    <div class="tabbed-panel" :class="{ collapsed: !open }">
        <!-- Tab bar (always visible) -->
        <div class="tab-bar">
            <button
                v-for="tab in tabs"
                :key="tab.id"
                class="tab-btn"
                :class="{ active: open && activeTab === tab.id }"
                :title="tab.title"
                @click="onTabClick(tab.id)"
            >
                {{ tab.label }}
            </button>
        </div>

        <!-- Tab content -->
        <div v-if="open" class="tab-content">
            <div v-show="activeTab === 'layers'">
                <layer-panel :counts="counts" @update:visibility="$emit('update:visibility', $event)" />
            </div>
            <div v-show="activeTab === 'settings'">
                <settings-panel v-if="game" :game="game" />
            </div>
            <div v-show="activeTab === 'logistics'">
                <logistics-debug-panel :game="game" />
            </div>
            <div v-show="activeTab === 'features'">
                <features-panel v-if="game" :game="game" />
            </div>
            <div v-show="activeTab === 'debug'">
                <debug-panel
                    v-if="game"
                    :game="game"
                    :paused="paused"
                    :currentRace="currentRace"
                    @togglePause="$emit('togglePause')"
                    @resetGameState="$emit('resetGameState')"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, provide } from 'vue';
import { debugStats } from '@/game/debug/debug-stats';
import type { Game } from '@/game/game';
import type { LayerVisibility } from '@/game/renderer/layer-visibility';
import type { LayerCounts } from '@/views/use-map-view';

import DebugPanel from './debug-panel.vue';
import LayerPanel from './layer-panel.vue';
import SettingsPanel from './settings-panel.vue';
import LogisticsDebugPanel from './logistics-debug-panel.vue';
import FeaturesPanel from './features-panel.vue';

// Tell child OverlayPanels to render in embedded (headless) mode
provide('overlay-panel-embedded', true);

defineProps<{
    game: Game | null;
    paused: boolean;
    currentRace: number;
    counts?: LayerCounts;
}>();

defineEmits<{
    (e: 'update:visibility', value: LayerVisibility): void;
    (e: 'togglePause' | 'resetGameState'): void;
}>();

const tabs = [
    { id: 'layers', label: 'Layers', title: 'Layer Panel' },
    { id: 'settings', label: 'Settings', title: 'Settings Panel' },
    { id: 'logistics', label: 'Logistics', title: 'Logistics Debug Panel' },
    { id: 'features', label: 'Features', title: 'Feature Toggles' },
    { id: 'debug', label: 'Debug', title: 'Debug Panel' },
] as const;

const activeTab = computed({
    get: () => debugStats.state.activeRightTab,
    set: (value: string) => {
        debugStats.state.activeRightTab = value;
    },
});

const open = computed({
    get: () => debugStats.state.rightPanelOpen,
    set: (value: boolean) => {
        debugStats.state.rightPanelOpen = value;
    },
});

function onTabClick(tabId: string): void {
    if (open.value && activeTab.value === tabId) {
        // Clicking the active tab toggles collapse
        open.value = false;
    } else {
        activeTab.value = tabId;
        open.value = true;
    }
}
</script>

<style scoped>
.tabbed-panel {
    background: rgba(13, 10, 5, 0.92);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: monospace;
    width: 380px;
    max-height: 100%;
    overflow-y: auto;
    pointer-events: auto;
}

.tabbed-panel.collapsed {
    width: auto;
}

/* Tab bar */
.tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border-soft);
}

.tab-btn {
    flex: 1;
    padding: 7px 4px;
    background: var(--bg-mid);
    color: var(--text-muted);
    border: none;
    border-right: 1px solid var(--border-faint);
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
}

.tab-btn:last-child {
    border-right: none;
}

.tab-btn:hover {
    background: var(--bg-raised);
    color: var(--text-bright);
}

.tab-btn.active {
    background: var(--bg-raised);
    color: var(--text-bright);
    border-bottom: 2px solid var(--text-accent, #d4a030);
    padding-bottom: 3px;
}

/* Tab content */
.tab-content {
    padding: 2px 0;
}

/* Scrollbar */
.tabbed-panel::-webkit-scrollbar {
    width: 4px;
}
.tabbed-panel::-webkit-scrollbar-track {
    background: var(--bg-darkest);
}
.tabbed-panel::-webkit-scrollbar-thumb {
    background: var(--border-mid);
    border-radius: 2px;
}
</style>

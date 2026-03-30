<template>
    <div
        v-if="!embedded"
        class="overlay-panel"
        :class="{ collapsed: !isOpen }"
        :style="minWidth !== '200px' ? { '--panel-min-width': minWidth } : {}"
    >
        <PanelToggleButton v-model:open="isOpen" :label="label" :title="title">
            <slot name="toggle-extra" />
        </PanelToggleButton>

        <div v-if="isOpen" class="panel-sections">
            <slot />
        </div>
    </div>
    <!-- Embedded mode: no chrome, always show content -->
    <div v-else class="panel-sections">
        <slot />
    </div>
</template>

<script setup lang="ts">
import { inject, ref, computed } from 'vue';
import { usePersistedRef } from '@/composables/use-persisted-ref';
import PanelToggleButton from './PanelToggleButton.vue';

const props = withDefaults(
    defineProps<{
        label: string;
        title?: string;
        minWidth?: string;
        /** When set, open state is persisted to localStorage (no v-model needed). */
        persistKey?: string;
        /** Default open state when using persistKey. */
        defaultOpen?: boolean;
    }>(),
    { minWidth: '200px', defaultOpen: true }
);

const open = defineModel<boolean>('open');
const embedded = inject<boolean>('overlay-panel-embedded', false);

// Internal persisted state (used when persistKey is provided)
const persisted = props.persistKey
    ? usePersistedRef(`panel:${props.persistKey}`, props.defaultOpen)
    : ref(props.defaultOpen);

// Use v-model when provided, otherwise use internal (optionally persisted) state
const isOpen = computed({
    get: () => open.value ?? persisted.value,
    set: (value: boolean) => {
        if (open.value !== undefined) {
            open.value = value;
        }
        persisted.value = value;
    },
});
</script>

<style scoped>
.overlay-panel {
    background: rgba(13, 10, 5, 0.92);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: monospace;
    width: var(--panel-min-width, 200px);
    max-height: 100%;
    overflow-y: auto;
    pointer-events: auto;
}

.overlay-panel.collapsed {
    width: auto;
}

.panel-sections {
    padding: 2px 0;
}

.overlay-panel::-webkit-scrollbar {
    width: 4px;
}
.overlay-panel::-webkit-scrollbar-track {
    background: var(--bg-darkest);
}
.overlay-panel::-webkit-scrollbar-thumb {
    background: var(--border-mid);
    border-radius: 2px;
}
</style>

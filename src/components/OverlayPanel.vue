<template>
    <div
        class="overlay-panel"
        :class="{ collapsed: !open }"
        :style="minWidth !== '200px' ? { '--panel-min-width': minWidth } : {}"
    >
        <PanelToggleButton v-model:open="open" :label="label" :title="title">
            <slot name="toggle-extra" />
        </PanelToggleButton>

        <div v-if="open" class="panel-sections">
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
import PanelToggleButton from './PanelToggleButton.vue';

withDefaults(
    defineProps<{
        label: string;
        title?: string;
        minWidth?: string;
    }>(),
    { minWidth: '200px' }
);

const open = defineModel<boolean>('open', { required: true });
</script>

<style scoped>
.overlay-panel {
    background: rgba(13, 10, 5, 0.92);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text);
    font-size: 11px;
    font-family: monospace;
    min-width: var(--panel-min-width, 200px);
    max-height: 100%;
    overflow-y: auto;
    pointer-events: auto;
}

.overlay-panel.collapsed {
    min-width: 0;
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

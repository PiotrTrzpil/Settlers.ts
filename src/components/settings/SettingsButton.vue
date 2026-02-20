<template>
    <button
        class="settings-btn"
        :class="{ active, small }"
        :disabled="disabled"
        :title="title"
        tabindex="-1"
        @click="onClick"
    >
        <slot />
    </button>
</template>

<script setup lang="ts">
defineProps<{
    active?: boolean;
    disabled?: boolean;
    title?: string;
    small?: boolean;
}>();

const emit = defineEmits<{
    (e: 'click'): void;
}>();

function onClick(e: MouseEvent) {
    emit('click');
    (e.target as HTMLButtonElement).blur();
}
</script>

<style scoped>
.settings-btn {
    padding: 4px 8px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    font-weight: bold;
    text-transform: uppercase;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.settings-btn:hover:not(:disabled) {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.settings-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.settings-btn.active {
    background: var(--border-mid);
    border-color: var(--border-hover);
    color: var(--text-emphasis);
}

.settings-btn.small {
    padding: 2px 6px;
    font-size: 9px;
}
</style>

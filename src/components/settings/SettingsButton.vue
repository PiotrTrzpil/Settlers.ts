<template>
    <button
        class="settings-btn"
        :class="{ active, small, danger, success, block }"
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
    danger?: boolean;
    success?: boolean;
    block?: boolean;
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
    background: #1a3a1a;
    border-color: #2a6a2a;
    color: var(--status-good);
}

.settings-btn.small {
    padding: 2px 6px;
    font-size: 9px;
}

.settings-btn.block {
    width: 100%;
}

.settings-btn.danger {
    background: #3a1a1a;
    color: #d08080;
    border-color: #5a2a2a;
}

.settings-btn.danger:hover:not(:disabled) {
    background: #4a2020;
    border-color: #7a3a3a;
}

.settings-btn.success {
    background: #1a3a1a;
    color: #80d080;
    border-color: #2a5a2a;
}

.settings-btn.success:hover:not(:disabled) {
    background: #204a20;
    border-color: #3a7a3a;
}
</style>

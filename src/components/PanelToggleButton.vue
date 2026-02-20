<template>
    <button class="panel-toggle-btn" :title="title" @click="$emit('update:open', !open)">
        <span class="toggle-icon">{{ open ? '&#x25BC;' : '&#x25B6;' }}</span>
        <span class="toggle-label">{{ label }}</span>
        <slot />
    </button>
</template>

<script setup lang="ts">
defineProps<{
    open: boolean;
    label: string;
    title?: string;
}>();

defineEmits<{
    (e: 'update:open', value: boolean): void;
}>();
</script>

<style scoped>
.panel-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-mid);
    color: var(--text-bright);
    border: none;
    border-bottom: 1px solid var(--border-soft);
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.panel-toggle-btn:hover {
    background: var(--bg-raised);
}

.toggle-icon {
    font-size: 8px;
    width: 10px;
    flex-shrink: 0;
}
</style>

<template>
    <div class="property-list">
        <div v-for="(row, i) in rows" :key="i" class="prop-row">
            <span class="prop-label">{{ row.label }}:</span>
            <span class="prop-value" :class="row.class">{{ row.value }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
export interface PropertyRow {
    label: string;
    value: string | number;
    class?: string;
}

defineProps<{
    rows: PropertyRow[];
}>();
</script>

<style scoped>
.property-list {
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 12px;
}

.prop-row {
    display: flex;
    padding: 4px 0;
    border-bottom: 1px solid var(--border-faint);
}

.prop-row:last-child {
    border-bottom: none;
}

.prop-label {
    color: var(--text-secondary);
    width: 140px;
    flex-shrink: 0;
}

.prop-value {
    color: var(--text);
    font-family: monospace;
}

.prop-value.valid {
    color: #4a8030;
}

.prop-value.invalid {
    color: #a04030;
}
</style>

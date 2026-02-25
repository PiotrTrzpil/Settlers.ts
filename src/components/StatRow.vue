<template>
    <div
        class="stat-row"
        :class="{
            'total-row': total,
            'sub-1': depth === 1,
            'sub-2': depth === 2,
        }"
    >
        <span class="stat-label" :class="{ dim }">{{ label }}</span>
        <slot
            ><span v-if="value !== undefined" class="stat-value">{{ value }}</span></slot
        >
    </div>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        label: string;
        value?: string | number;
        total?: boolean;
        depth?: number;
        dim?: boolean;
    }>(),
    {
        total: false,
        depth: 0,
        dim: false,
    }
);
</script>

<style scoped>
.stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 1px 0;
    gap: 12px;
}

.stat-label {
    color: var(--text-muted);
}

.stat-label.dim {
    color: var(--text-ghost);
    font-style: italic;
}

.stat-value {
    color: var(--text-bright);
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* Sub-rows (depth 1) */
.sub-1 {
    padding-left: 12px;
}

.sub-1 .stat-label {
    color: var(--text-faint);
    font-size: 10px;
}

.sub-1 .stat-value {
    color: var(--text-muted);
    font-size: 10px;
}

/* Sub-rows (depth 2) */
.sub-2 {
    padding-left: 24px;
}

.sub-2 .stat-label {
    color: var(--text-ghost);
    font-size: 10px;
}

.sub-2 .stat-value {
    color: var(--text-secondary);
    font-size: 10px;
}

/* Total / summary row */
.total-row {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border-soft);
    font-weight: bold;
}

.total-row .stat-value {
    color: var(--text-emphasis);
}
</style>

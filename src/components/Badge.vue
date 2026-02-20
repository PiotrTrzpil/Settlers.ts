<template>
    <span class="badge" :class="[`badge-${color}`, { 'badge-round': round }]">
        <slot />
    </span>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        color?: 'neutral' | 'count' | 'success' | 'warn' | 'alert' | 'info';
        round?: boolean;
    }>(),
    {
        color: 'neutral',
        round: false,
    }
);
</script>

<style scoped>
.badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 2px;
    font-size: 9px;
    font-weight: normal;
    line-height: 1.4;
    white-space: nowrap;
}

.badge-round {
    border-radius: 10px;
}

/* neutral: dim label ("experimental", off-states) */
.badge-neutral {
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
}

/* count: warm elevated count pill ("+2") */
.badge-count {
    background: var(--bg-raised);
    border: 1px solid var(--border-mid);
    color: var(--text-emphasis);
}

/* status variants */
.badge-success {
    background: #1a2a1a;
    border: 1px solid #2a4a2a;
    color: var(--status-good);
}

.badge-warn {
    background: #2a2a1a;
    border: 1px solid #4a4a2a;
    color: var(--status-warn);
}

.badge-alert {
    background: #2a1a0a;
    border: 1px solid #5a3020;
    color: var(--status-alert);
}

.badge-info {
    background: #1a1a2a;
    border: 1px solid #2a2a4a;
    color: #8080c0;
}
</style>

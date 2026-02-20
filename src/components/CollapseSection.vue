<template>
    <section class="collapse-section">
        <h3 class="section-header" @click="expanded = !expanded">
            <span class="caret">{{ expanded ? '&#x25BC;' : '&#x25B6;' }}</span>
            <slot name="title">{{ title }}</slot>
            <slot name="title-extra" />
        </h3>
        <div v-if="expanded" class="section-body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
    defineProps<{
        title?: string;
        defaultOpen?: boolean;
    }>(),
    {
        defaultOpen: true,
    }
);

const expanded = ref(props.defaultOpen);
</script>

<style scoped>
.collapse-section {
    border-bottom: 1px solid var(--border-faint);
}

.section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    margin: 0;
    font-size: 10px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
}

.section-header:hover {
    color: var(--text);
    background: rgba(60, 40, 16, 0.3);
}

.caret {
    font-size: 7px;
    width: 10px;
    flex-shrink: 0;
}

.section-body {
    padding: 2px 10px 6px;
}
</style>

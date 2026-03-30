<template>
    <CollapseSection title="Performance" persist-key="debug-performance">
        <StatRow label="FPS"
            ><span :class="fpsClass">{{ stats.fps }}</span></StatRow
        >
        <StatRow label="Frame (avg)" :value="`${stats.frameTimeMs} ms`" />
        <StatRow label="Frame (min/max)" :value="`${stats.frameTimeMin} / ${stats.frameTimeMax} ms`" />
        <StatRow label="Ticks/sec" :value="stats.ticksPerSec" />
    </CollapseSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { debugStats } from '@/game/debug/debug-stats';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';

const stats = debugStats.state;

const fpsClass = computed(() => {
    if (stats.fps >= 55) {
        return 'fps-good';
    }
    if (stats.fps >= 30) {
        return 'fps-ok';
    }
    return 'fps-bad';
});
</script>

<style scoped>
.fps-good {
    color: var(--status-good);
}
.fps-ok {
    color: var(--text-accent);
}
.fps-bad {
    color: var(--status-bad);
}
</style>

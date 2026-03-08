<template>
    <CollapseSection title="Frame Timings" :default-open="false">
        <StatRow label="Frame" :value="`${rt.frame} ms`" total />
        <StatRow label="Ticks" :value="`${rt.ticks} ms`" />
        <StatRow v-for="(ms, name) in rt.tickSystems" :key="name" :label="name" :value="`${ms} ms`" :depth="1" />
        <StatRow label="Animations" :value="`${rt.animations} ms`" />
        <StatRow label="Update" :value="`${rt.update} ms`" />
        <StatRow label="Callback" :value="`${rt.callback} ms`" />
        <StatRow label="Idle" :value="`${rt.idle} ms`" />
        <StatRow label="Render" :value="`${rt.render} ms`" />
        <StatRow label="Landscape" :value="`${rt.landscape} ms`" :depth="1" />
        <StatRow label="Cull/Sort" :value="`${rt.cullSort} ms`" :depth="1" />
        <StatRow label="Entities" :value="`${rt.entities} ms`" :depth="1" />
        <StatRow label="Indicators" :value="`${rt.indicators} ms`" :depth="2" />
        <StatRow label="Textured" :value="`${rt.textured} ms`" :depth="2" />
        <StatRow label="Color" :value="`${rt.color} ms`" :depth="2" />
        <StatRow label="Selection" :value="`${rt.selection} ms`" :depth="2" />
        <StatRow label="Visible" :value="rt.visibleCount" :depth="1" />
        <StatRow label="Sprites" :value="rt.spriteCount" :depth="1" />
        <StatRow label="Draw calls" :value="rt.drawCalls" :depth="1" />
    </CollapseSection>
</template>

<script setup lang="ts">
import { debugStats } from '@/game/debug/debug-stats';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';

const rt = debugStats.state.renderTimings;
</script>

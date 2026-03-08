<template>
    <CollapseSection title="Map Load" :default-open="false">
        <template v-if="totalMs > 0">
            <StatRow label="File Read" :value="`${mlt.fileRead} ms`" />
            <StatRow label="Map Parse" :value="`${mlt.mapParse} ms`" />
            <StatRow label="Game Constructor" :value="`${mlt.gameConstructor} ms`" />
            <StatRow label="Terrain" :value="`${mlt.terrain} ms`" :depth="1" />
            <StatRow label="Services" :value="`${mlt.gameInit} ms`" :depth="1" />
            <StatRow label="Trees" :value="`${mlt.populateTrees} ms`" :depth="1" />
            <StatRow
                v-if="mlt.treeExpansion > 0"
                label="Tree Expansion"
                :value="`${mlt.treeExpansion} ms`"
                :depth="2"
            />
            <StatRow label="Buildings" :value="`${mlt.populateBuildings} ms`" :depth="1" />
            <StatRow label="Units" :value="`${mlt.populateUnits} ms`" :depth="1" />
            <StatRow label="Stacks" :value="`${mlt.populateStacks} ms`" :depth="1" />
            <StatRow v-if="mlt.stateRestore > 0" label="State Restore" :value="`${mlt.stateRestore} ms`" />
            <StatRow label="Renderer Init" :value="`${mlt.rendererInit} ms`" />
            <StatRow label="Landscape" :value="`${slt.landscape} ms`" :depth="1" />
            <StatRow v-if="slt.cacheWait > 0" label="Cache Wait" :value="`${slt.cacheWait} ms`" :depth="1" />
            <StatRow label="Sprite Load" :value="spriteLoadLabel" :depth="1" />
            <template v-if="slt.cacheHit">
                <StatRow label="Deserialize" :value="`${slt.deserialize} ms`" :depth="2" />
                <StatRow label="Atlas Restore" :value="`${slt.atlasRestore} ms`" :depth="3" />
                <StatRow label="Registry" :value="`${slt.registryDeserialize} ms`" :depth="3" />
                <StatRow label="GPU Upload" :value="`${slt.gpuUpload} ms (${slt.gpuLayers} layers)`" :depth="2" />
                <StatRow label="Palette Upload" :value="`${slt.paletteUpload} ms`" :depth="2" />
                <StatRow label="Selection Indicators" :value="`${slt.selectionIndicators} ms`" :depth="2" />
            </template>
            <template v-else>
                <StatRow label="File Preload" :value="`${slt.filePreload} ms`" :depth="2" />
                <StatRow label="Atlas Alloc" :value="`${slt.atlasAlloc} ms`" :depth="2" />
                <StatRow label="Buildings" :value="`${slt.buildings} ms`" :depth="2" />
                <StatRow label="Map Objects" :value="`${slt.mapObjects} ms`" :depth="2" />
                <StatRow label="Resources" :value="`${slt.goods} ms`" :depth="2" />
                <StatRow label="Units" :value="`${slt.units} ms`" :depth="2" />
                <StatRow
                    v-for="(ms, name) in slt.unitsByRace"
                    :key="name"
                    :label="name"
                    :value="`${ms} ms`"
                    :depth="3"
                />
                <StatRow label="Selection Indicators" :value="`${slt.selectionIndicators} ms`" :depth="2" />
                <StatRow label="GPU Upload" :value="`${slt.gpuUpload} ms (${slt.gpuLayers} layers)`" :depth="2" />
            </template>
            <StatRow
                v-if="slt.overlaySprites > 0"
                label="Overlay Sprites"
                :value="`${slt.overlaySprites} ms`"
                :depth="1"
            />
            <StatRow label="Total (wall)" :value="`${mlt.totalLoad} ms`" total />
            <StatRow label="Map Size" :value="mlt.mapSize || '-'" />
            <StatRow label="Entities" :value="mlt.entityCount" />
            <StatRow label="Atlas" :value="slt.atlasSize || '-'" />
            <StatRow label="Sprites" :value="slt.spriteCount" />
            <StatRow label="Cache"
                ><span :class="cacheClass">{{ cacheLabel }}</span></StatRow
            >
        </template>
        <StatRow v-else label="No map loaded yet" dim />
    </CollapseSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { debugStats } from '@/game/debug/debug-stats';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';

const mlt = debugStats.state.mapLoadTimings;
const slt = debugStats.state.loadTimings;

const cacheLabel = computed(() => {
    if (!slt.cacheHit) return 'MISS';
    if (slt.cacheSource === 'module') return 'HIT (HMR)';
    if (slt.cacheSource === 'indexeddb') return 'HIT (IDB)';
    return 'HIT';
});

const cacheClass = computed(() => {
    if (!slt.cacheHit) return 'cache-miss';
    if (slt.cacheSource === 'module') return 'cache-hit-hmr';
    if (slt.cacheSource === 'indexeddb') return 'cache-hit-idb';
    return 'cache-hit-hmr';
});

/** Use wall-clock total if available, fall back to sum of phases for display guard */
const totalMs = computed(
    () =>
        mlt.totalLoad ||
        mlt.fileRead + mlt.mapParse + mlt.gameConstructor + mlt.stateRestore + slt.landscape + slt.totalSprites
);

const spriteLoadLabel = computed(() => {
    const ms = `${slt.totalSprites} ms`;
    if (!slt.cacheHit) return ms;
    const src = slt.cacheSource === 'module' ? 'HMR' : 'IDB';
    return `${ms} (cached: ${src})`;
});
</script>

<style scoped>
.cache-hit-hmr {
    color: var(--status-good);
    font-weight: bold;
}
.cache-hit-idb {
    color: #80b0c0;
    font-weight: bold;
}
.cache-miss {
    color: var(--text-muted);
}
</style>

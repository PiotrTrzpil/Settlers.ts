<template>
    <OverlayPanel v-model:open="open" label="Debug" title="Debug Panel">
        <!-- Performance -->
        <CollapseSection title="Performance">
            <StatRow label="FPS"
                ><span :class="fpsClass">{{ stats.fps }}</span></StatRow
            >
            <StatRow label="Frame (avg)" :value="`${stats.frameTimeMs} ms`" />
            <StatRow label="Frame (min/max)" :value="`${stats.frameTimeMin} / ${stats.frameTimeMax} ms`" />
            <StatRow label="Ticks/sec" :value="stats.ticksPerSec" />
        </CollapseSection>

        <!-- Render Timings -->
        <CollapseSection title="Frame Timings" :default-open="false">
            <StatRow label="Frame" :value="`${stats.renderTimings.frame} ms`" total />
            <StatRow label="Ticks" :value="`${stats.renderTimings.ticks} ms`" />
            <StatRow
                v-for="(ms, name) in stats.renderTimings.tickSystems"
                :key="name"
                :label="name"
                :value="`${ms} ms`"
                :depth="1"
            />
            <StatRow label="Animations" :value="`${stats.renderTimings.animations} ms`" />
            <StatRow label="Update" :value="`${stats.renderTimings.update} ms`" />
            <StatRow label="Callback" :value="`${stats.renderTimings.callback} ms`" />
            <StatRow label="Idle" :value="`${stats.renderTimings.idle} ms`" />
            <StatRow label="Render" :value="`${stats.renderTimings.render} ms`" />
            <StatRow label="Landscape" :value="`${stats.renderTimings.landscape} ms`" :depth="1" />
            <StatRow label="Cull/Sort" :value="`${stats.renderTimings.cullSort} ms`" :depth="1" />
            <StatRow label="Entities" :value="`${stats.renderTimings.entities} ms`" :depth="1" />
            <StatRow label="Indicators" :value="`${stats.renderTimings.indicators} ms`" :depth="2" />
            <StatRow label="Textured" :value="`${stats.renderTimings.textured} ms`" :depth="2" />
            <StatRow label="Color" :value="`${stats.renderTimings.color} ms`" :depth="2" />
            <StatRow label="Selection" :value="`${stats.renderTimings.selection} ms`" :depth="2" />
            <StatRow label="Visible" :value="stats.renderTimings.visibleCount" :depth="1" />
            <StatRow label="Sprites" :value="stats.renderTimings.spriteCount" :depth="1" />
            <StatRow label="Draw calls" :value="stats.renderTimings.drawCalls" :depth="1" />
        </CollapseSection>

        <!-- Load Timings -->
        <CollapseSection title="Load Timings" :default-open="false">
            <StatRow label="Landscape" :value="`${stats.loadTimings.landscape} ms`" />
            <StatRow label="File preload" :value="`${stats.loadTimings.filePreload} ms`" />
            <StatRow label="Atlas alloc" :value="`${stats.loadTimings.atlasAlloc} ms`" />
            <StatRow label="Buildings" :value="`${stats.loadTimings.buildings} ms`" />
            <StatRow label="Map objects" :value="`${stats.loadTimings.mapObjects} ms`" />
            <StatRow label="Resources" :value="`${stats.loadTimings.resources} ms`" />
            <StatRow label="Units" :value="`${stats.loadTimings.units} ms`" />
            <StatRow label="GPU upload" :value="`${stats.loadTimings.gpuUpload} ms`" />
            <StatRow label="Total sprites" :value="`${stats.loadTimings.totalSprites} ms`" total />
            <StatRow label="Atlas size" :value="stats.loadTimings.atlasSize || '-'" />
            <StatRow label="Sprite count" :value="stats.loadTimings.spriteCount" />
            <StatRow label="Cache"
                ><span :class="cacheClass">{{ cacheLabel }}</span></StatRow
            >
        </CollapseSection>

        <!-- Entities -->
        <CollapseSection title="Entities">
            <StatRow label="Total" :value="view.entityCount" />
            <StatRow label="Buildings" :value="view.buildingCount" />
            <StatRow label="Units" :value="view.unitCount" />
            <StatRow label="Moving" :value="view.unitsMoving" />
            <StatRow label="Path steps" :value="view.totalPathSteps" />
        </CollapseSection>

        <!-- Camera -->
        <CollapseSection title="Camera">
            <StatRow label="Position" :value="`${stats.cameraX}, ${stats.cameraY}`" />
            <StatRow label="Zoom" :value="`${stats.zoom}x`" />
            <StatRow label="Canvas" :value="`${stats.canvasWidth} x ${stats.canvasHeight}`" />
        </CollapseSection>

        <!-- Tile -->
        <CollapseSection title="Tile">
            <template v-if="stats.hasTile">
                <StatRow label="Coords" :value="`${stats.tileX}, ${stats.tileY}`" />
                <StatRow label="Ground type" :value="stats.tileGroundType" />
                <StatRow label="Height" :value="stats.tileGroundHeight" />
            </template>
            <StatRow v-else label="Move mouse over map" dim />
        </CollapseSection>

        <!-- Controls -->
        <CollapseSection title="Controls">
            <div class="control-buttons">
                <button class="ctrl-btn" @click="$emit('togglePause')">
                    {{ paused ? 'Resume' : 'Pause' }}
                </button>
                <button class="ctrl-btn danger" @click="$emit('resetGameState')">Reset State</button>
            </div>
            <Checkbox v-model="settings.showBuildingFootprint" label="Show building footprints" />
            <div class="river-debug">
                <span class="river-heading stat-label">River textures</span>
                <StatRow label="Slots (I/O/M)">
                    <span class="perm-control">
                        <button class="perm-btn" @click="cycleSlotPerm(-1)">&lt;</button>
                        <span class="perm-value">{{ slotPermLabel }}</span>
                        <button class="perm-btn" @click="cycleSlotPerm(1)">&gt;</button>
                    </span>
                </StatRow>
                <Checkbox
                    v-model="stats.riverFlipInner"
                    label="Flip inner (River3↔River1)"
                    @update:modelValue="applyRiverConfig()"
                />
                <Checkbox
                    v-model="stats.riverFlipOuter"
                    label="Flip outer (Grass↔River4)"
                    @update:modelValue="applyRiverConfig()"
                />
                <Checkbox
                    v-model="stats.riverFlipMiddle"
                    label="Flip middle (River4↔River3)"
                    @update:modelValue="applyRiverConfig()"
                />
                <StatRow label="" dim :value="`${configIndex}/48`" />
            </div>
        </CollapseSection>

        <!-- Map Objects -->
        <CollapseSection title="Map Objects" :default-open="false">
            <Checkbox
                v-model="treeExpansionEnabled"
                label="Tree expansion (reload)"
                @update:modelValue="onTreeExpansionChange"
            />
            <div class="map-obj-row">
                <span class="stat-label">Trees</span>
                <span class="stat-value">{{ mapObjectCounts.trees }}</span>
                <button class="spawn-btn" @click="spawnCategory('trees')">+</button>
            </div>
            <div class="map-obj-row">
                <span class="stat-label">Stones</span>
                <span class="stat-value">{{ mapObjectCounts.stones }}</span>
                <button class="spawn-btn" @click="spawnCategory('stones')">+</button>
            </div>
            <div class="map-obj-row">
                <span class="stat-label">Resources</span>
                <span class="stat-value">{{ mapObjectCounts.resources }}</span>
                <button class="spawn-btn" @click="spawnCategory('resources')">+</button>
            </div>
            <div class="map-obj-row">
                <span class="stat-label">Plants</span>
                <span class="stat-value">{{ mapObjectCounts.plants }}</span>
                <button class="spawn-btn" @click="spawnCategory('plants')">+</button>
            </div>
            <div class="map-obj-actions">
                <button class="ctrl-btn" @click="spawnAllFromMap()">From Map</button>
                <button class="ctrl-btn" @click="clearAllMapObjects()">Clear</button>
            </div>
            <StatRow v-if="!hasObjectTypeData" label="No map object data (test map)" dim />
        </CollapseSection>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { debugStats } from '@/game/debug-stats';
import { RIVER_SLOT_PERMS } from '@/game/renderer/landscape/textures/landscape-texture-map';
import type { Game } from '@/game/game';
import { clearSavedTreeState } from '@/game/game-state-persistence';
import { useDebugMapObjects } from './use-debug-map-objects';
import Checkbox from './Checkbox.vue';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';
import OverlayPanel from './OverlayPanel.vue';

const props = defineProps<{
    paused: boolean;
    currentRace: number; // Race enum
    game: Game;
}>();

defineEmits<{
    (e: 'togglePause' | 'resetGameState'): void;
}>();

const stats = debugStats.state;
const view = props.game.viewState.state;
const settings = props.game.settings.state;

// Use the persisted open state from debug stats
const open = computed({
    get: () => stats.debugPanelOpen,
    set: (value: boolean) => {
        stats.debugPanelOpen = value;
    },
});

// Tree expansion toggle (persisted in localStorage, requires reload)
const treeExpansionEnabled = ref(localStorage.getItem('settlers_treeExpansion') !== 'false');
function onTreeExpansionChange(val: boolean): void {
    localStorage.setItem('settlers_treeExpansion', val ? 'true' : 'false');
    // Strip tree entities from saved state so next reload re-populates from map data
    clearSavedTreeState();
}

// Map objects functionality (extracted to composable)
const getGame = (): Game | null => props.game;
const { mapObjectCounts, hasObjectTypeData, spawnCategory, spawnAllFromMap, clearAllMapObjects } =
    useDebugMapObjects(getGame);

const slotPermLabel = computed(() => {
    const perm = RIVER_SLOT_PERMS[stats.riverSlotPermutation % RIVER_SLOT_PERMS.length]!;
    return perm.join('-');
});

const configIndex = computed(() => {
    return (
        stats.riverSlotPermutation * 8 +
        (stats.riverFlipInner ? 4 : 0) +
        (stats.riverFlipOuter ? 2 : 0) +
        (stats.riverFlipMiddle ? 1 : 0) +
        1
    );
});

function applyRiverConfig() {
    const lr = window.__settlers__?.landscape;
    if (lr) {
        lr.rebuildRiverTextures({
            slotPermutation: stats.riverSlotPermutation,
            flipInner: stats.riverFlipInner,
            flipOuter: stats.riverFlipOuter,
            flipMiddle: stats.riverFlipMiddle,
        });
    }
}

function cycleSlotPerm(dir: number) {
    const len = RIVER_SLOT_PERMS.length;
    stats.riverSlotPermutation = (((stats.riverSlotPermutation + dir) % len) + len) % len;
    applyRiverConfig();
}

const fpsClass = computed(() => {
    if (stats.fps >= 55) return 'fps-good';
    if (stats.fps >= 30) return 'fps-ok';
    return 'fps-bad';
});

const cacheLabel = computed(() => {
    if (!stats.loadTimings.cacheHit) return 'MISS';
    if (stats.loadTimings.cacheSource === 'module') return 'HIT (HMR)';
    if (stats.loadTimings.cacheSource === 'indexeddb') return 'HIT (IDB)';
    return 'HIT';
});

const cacheClass = computed(() => {
    if (!stats.loadTimings.cacheHit) return 'cache-miss';
    if (stats.loadTimings.cacheSource === 'module') return 'cache-hit-hmr';
    if (stats.loadTimings.cacheSource === 'indexeddb') return 'cache-hit-idb';
    return 'cache-hit-hmr';
});
</script>

<style scoped>
/* Stat label/value used directly in map-obj and river sections */
.stat-label {
    color: var(--text-muted);
}

.stat-value {
    color: var(--text-bright);
    text-align: right;
}

/* Status colors */
.fps-good {
    color: var(--status-good);
}
.fps-ok {
    color: var(--text-accent);
}
.fps-bad {
    color: var(--status-bad);
}

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

/* Controls section */
.control-buttons {
    display: flex;
    gap: 4px;
    margin-top: 4px;
}

.ctrl-btn {
    flex: 1;
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
}

.ctrl-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.ctrl-btn.danger {
    background: #3a1a1a;
    border-color: #6a2020;
    color: #d08080;
}

.ctrl-btn.danger:hover {
    background: #4a2020;
    border-color: #8a3030;
}

/* River debug */
.river-debug {
    margin-top: 6px;
}

.river-heading {
    display: block;
    margin-bottom: 4px;
}

.perm-control {
    display: flex;
    align-items: center;
    gap: 4px;
}

.perm-btn {
    padding: 1px 6px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 2px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    line-height: 1;
}

.perm-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.perm-value {
    color: var(--text-bright);
    font-weight: bold;
    min-width: 36px;
    text-align: center;
}

/* Map Objects section */
.map-obj-row {
    display: flex;
    align-items: center;
    padding: 2px 0;
    gap: 8px;
}

.map-obj-row .stat-label {
    flex: 1;
}

.map-obj-row .stat-value {
    min-width: 30px;
    text-align: right;
}

.spawn-btn {
    padding: 1px 6px;
    background: #1a3a1a;
    color: var(--status-good);
    border: 1px solid #2a5a2a;
    border-radius: 2px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    font-weight: bold;
    line-height: 1;
}

.spawn-btn:hover {
    background: #2a4a2a;
    border-color: #3a6a3a;
}

.map-obj-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
}
</style>

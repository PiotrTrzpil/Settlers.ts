<template>
    <div class="map-view-root">
        <!-- Main game area: sidebar + canvas -->
        <div
            v-if="game"
            class="game-layout"
            data-testid="game-ui"
            @mouseup="blurNonTextInput"
            @change="blurNonTextInput"
        >
            <!-- LEFT SIDEBAR -->
            <aside class="sidebar">
                <!-- Player selector -->
                <div class="sidebar-selector">
                    <label>Player:</label>
                    <select v-model="currentPlayer" @change="onPlayerChange" data-testid="player-select">
                        <option v-for="p in availablePlayers" :key="p.index" :value="p.index">
                            {{ p.label }}
                        </option>
                    </select>
                </div>

                <!-- Race selector -->
                <div class="sidebar-selector">
                    <label>Race:</label>
                    <select v-model="currentRace" @change="onRaceChange" data-testid="race-select">
                        <option v-for="race in availableRaces" :key="race.value" :value="race.value">
                            {{ race.name }}
                        </option>
                    </select>
                </div>

                <!-- Tab strip -->
                <div class="sidebar-tabs">
                    <button
                        class="tab-btn"
                        :class="{ active: activeTab === 'buildings' }"
                        @click="activeTab = 'buildings'"
                    >
                        Build
                    </button>
                    <button class="tab-btn" :class="{ active: activeTab === 'units' }" @click="activeTab = 'units'">
                        Units
                    </button>
                    <button
                        class="tab-btn"
                        :class="{ active: activeTab === 'resources' }"
                        @click="activeTab = 'resources'"
                    >
                        Goods
                    </button>
                    <button
                        class="tab-btn"
                        :class="{ active: activeTab === 'specialists' }"
                        @click="activeTab = 'specialists'"
                    >
                        SP
                    </button>
                </div>

                <!-- Buildings tab -->
                <div v-if="activeTab === 'buildings'" class="tab-content building-list" data-testid="building-palette">
                    <Checkbox v-model="placeBuildingsCompleted" label="Place as completed" />
                    <Checkbox v-model="placeBuildingsWithWorker" label="Place with worker" />
                    <button
                        v-for="b in availableBuildings"
                        :key="b.type"
                        class="sidebar-btn"
                        :data-testid="'btn-' + b.id"
                        :class="{ active: currentMode === 'place_building' && placeBuildingType === b.type }"
                        @click="setPlaceMode(b.type)"
                    >
                        <span class="btn-icon">
                            <img
                                v-if="buildingIcons[b.type]"
                                :src="buildingIcons[b.type]!.url"
                                :alt="b.name"
                                class="building-icon-img"
                                :style="{
                                    width: buildingIcons[b.type]!.size + 'px',
                                    height: buildingIcons[b.type]!.size + 'px',
                                }"
                            />
                            <span v-else>{{ b.icon }}</span>
                        </span>
                        <span class="btn-label">{{ b.name }}</span>
                    </button>
                </div>

                <!-- Units tab -->
                <div v-if="activeTab === 'units'" class="tab-content" data-testid="unit-controls">
                    <button
                        v-for="u in availableUnits"
                        :key="u.id"
                        class="sidebar-btn"
                        :data-testid="'btn-spawn-' + u.id"
                        :class="{
                            active: currentMode === 'place_unit' && placeUnitType === u.type,
                        }"
                        @click="setPlaceUnitMode(u.type)"
                    >
                        <span class="btn-icon">
                            <img
                                v-if="unitIcons[u.id]"
                                :src="unitIcons[u.id]!.url"
                                :alt="u.name"
                                class="building-icon-img"
                                :style="{
                                    width: unitIcons[u.id]!.size + 'px',
                                    height: unitIcons[u.id]!.size + 'px',
                                }"
                            />
                            <span v-else>{{ u.icon }}</span>
                        </span>
                        <span class="btn-label">{{ u.name }}</span>
                    </button>
                </div>

                <!-- Specialists tab -->
                <div v-if="activeTab === 'specialists'" class="tab-content">
                    <specialists-panel
                        :game="game"
                        :race="currentRace"
                        :specialist-icons="specialistIcons"
                        :get-camera-center="() => rendererRef?.getCamera?.() ?? null"
                    />
                </div>

                <!-- Resources tab -->
                <div v-if="activeTab === 'resources'" class="tab-content" data-testid="resource-palette">
                    <div class="resource-params">
                        <label>Amount:</label>
                        <input type="number" v-model.number="resourceAmount" min="1" max="8" class="amount-input" />
                    </div>
                    <button
                        v-for="r in availableResources"
                        :key="r.type"
                        class="sidebar-btn"
                        :data-testid="'btn-resource-' + r.id"
                        :class="{ active: currentMode === 'place_pile' && placeResourceType === r.type }"
                        @click="setPlaceResourceMode(r.type)"
                    >
                        <span class="btn-icon">
                            <img v-if="resourceIcons[r.type]" :src="resourceIcons[r.type]" class="resource-icon" />
                            <span v-else>{{ r.icon }}</span>
                        </span>
                        <span class="btn-label">{{ r.name }}</span>
                    </button>
                </div>
            </aside>

            <!-- RIGHT: Canvas area + info bar -->
            <div class="canvas-area">
                <!-- Info bar -->
                <div class="info-bar">
                    <div class="map-selector">
                        <span class="info-label">Map:</span>
                        <file-browser
                            :fileManager="fileManager"
                            @select="onFileSelect"
                            filter=".map"
                            storageKey="viewer_map_file"
                            class="browser"
                        />
                    </div>
                    <div class="mode-indicator" data-testid="mode-indicator" :data-mode="currentMode">
                        Mode: <strong>{{ currentMode }}</strong>
                    </div>
                    <div
                        class="tile-info"
                        data-testid="tile-info"
                        v-if="hoveredTile"
                        :data-tile-x="hoveredTile.x"
                        :data-tile-y="hoveredTile.y"
                    >
                        Tile: ({{ hoveredTile.x }}, {{ hoveredTile.y }})
                    </div>
                    <div
                        class="entity-info"
                        data-testid="entity-info"
                        v-if="selectedEntity"
                        :data-entity-id="selectedEntity.id"
                        :data-selection-count="selectionCount"
                    >
                        Selected: {{ selectedEntity.type === 1 ? 'Unit' : 'Building' }} #{{ selectedEntity.id }} at ({{
                            selectedEntity.x
                        }}, {{ selectedEntity.y }})
                        <span v-if="selectionCount > 1"> (+{{ selectionCount - 1 }} more)</span>
                    </div>
                </div>

                <!-- Canvas fills remaining space -->
                <renderer-viewer
                    ref="rendererRef"
                    :key="rendererKey"
                    :game="game"
                    :debugGrid="showDebug"
                    :layerVisibility="layerVisibility"
                    :initialCamera="savedCamera"
                    @tileClick="onTileClick"
                    class="game-canvas"
                />

                <!-- "Ticks paused" overlay — visible when game loop runs but ticks don't -->
                <div v-if="ticksPaused && !staleSnapshotWarning" class="ticks-paused-overlay">TICKS PAUSED</div>

                <!-- Stale save data warning — blocks interaction until user decides -->
                <div v-if="staleSnapshotWarning" class="stale-save-backdrop">
                    <div class="stale-save-dialog">
                        <h2 class="stale-save-title">Incompatible Save Data</h2>
                        <p class="stale-save-message">
                            A saved game was found, but it was created with an older version
                            and can no longer be loaded. The game is paused until you decide.
                        </p>
                        <div class="stale-save-actions">
                            <button class="stale-save-btn stale-save-btn--discard" @click="dismissStaleSnapshot">
                                Discard &amp; Start Fresh
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Left panel container (selection info) -->
                <div class="left-panels">
                    <selection-panel :game="game" />
                </div>

                <!-- Right panel container (tabbed: layers, settings, logistics, debug) -->
                <div class="right-panels">
                    <tabbed-panel
                        :game="game"
                        :paused="isPaused"
                        :currentRace="currentRace"
                        :counts="layerCounts"
                        @update:visibility="updateLayerVisibility"
                        @togglePause="togglePause()"
                        @resetGameState="onResetGameState()"
                    />
                </div>
            </div>
        </div>

        <!-- Fallback when no game loaded -->
        <div v-if="!game" class="no-game-fallback">
            <div class="info-bar">
                <div class="map-selector">
                    <span class="info-label">Map:</span>
                    <file-browser
                        :fileManager="fileManager"
                        @select="onFileSelect"
                        filter=".map"
                        storageKey="viewer_map_file"
                        class="browser"
                    />
                </div>
            </div>
            <renderer-viewer
                :game="game"
                :debugGrid="showDebug"
                :layerVisibility="layerVisibility"
                @tileClick="onTileClick"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, useTemplateRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { useMapView } from './use-map-view';
import { Race, RACE_NAMES, AVAILABLE_RACES, loadSavedRace, saveSavedRace } from '@/game/renderer/sprite-metadata';
import type { Game } from '@/game/game';
import { SoundManager } from '@/game/audio/sound-manager';
import { saveCameraState, clearCameraState } from '@/game/renderer/camera-persistence';
import { getCurrentMapId } from '@/game/state/game-state-persistence';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';
import SelectionPanel from '@/components/selection-panel.vue';
import TabbedPanel from '@/components/TabbedPanel.vue';
import Checkbox from '@/components/Checkbox.vue';
import SpecialistsPanel from '@/components/SpecialistsPanel.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

// Template ref for renderer - declared before useMapView so getter works
const rendererRef = useTemplateRef<InstanceType<typeof RendererViewer>>('rendererRef');

// Player & race selection — declared before useMapView so they can drive building/unit filtering
const currentPlayer = ref(0);
const currentRace = ref<Race>(loadSavedRace());

const {
    game,
    showDebug,
    activeTab,
    resourceAmount,
    resourceIcons,
    hoveredTile,
    selectedEntity,
    selectionCount,
    isPaused,
    currentMode,
    placeBuildingType,
    placeResourceType,
    placeUnitType,
    availableBuildings,
    availableUnits,
    availableResources,
    layerVisibility,
    layerCounts,
    onFileSelect,
    onTileClick,
    setPlaceMode: setPlaceModeBase,
    setPlaceResourceMode,
    setPlaceUnitMode,
    togglePause,
    resetGameState,
    updateLayerVisibility,
    buildingIcons,
    unitIcons,
    specialistIcons,
    staleSnapshotWarning,
    dismissStaleSnapshot,
} = useMapView(
    () => props.fileManager,
    () => rendererRef.value?.getInputManager?.() ?? null,
    currentRace
);

/** Blur non-text inputs after interaction so keyboard focus returns to the game. */
function blurNonTextInput(e: Event): void {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    const tag = active.tagName;
    const isNonTextInput =
        tag === 'SELECT' || tag === 'BUTTON' || (tag === 'INPUT' && (active as HTMLInputElement).type === 'checkbox');
    if (!isNonTextInput) return;

    if (e.type === 'change') {
        // SELECT changed value — blur after Vue re-renders
        void nextTick(() => active.blur());
    } else if (e.type === 'mouseup' && e.target !== active) {
        // User clicked away from focused input — blur immediately
        active.blur();
    }
}

const availableRaces = AVAILABLE_RACES.map(race => ({
    value: race,
    name: RACE_NAMES[race],
}));

// Player list from the loaded map (ref, populated in watch to avoid shallowRef reactivity issues)
const availablePlayers = ref([{ index: 0, label: 'P0' }]);

function buildPlayerList(g: Game): { index: number; label: string }[] {
    if (g.playerRaces.size === 0) {
        throw new Error('No player data in loaded map — playerRaces is empty');
    }
    const players: { index: number; label: string }[] = [];
    for (const [idx, race] of g.playerRaces) {
        players.push({ index: idx, label: `P${idx} ${RACE_NAMES[race]}` });
    }
    players.sort((a, b) => a.index - b.index);
    return players;
}

function onPlayerChange() {
    const g = game.value;
    if (!g) return;
    g.currentPlayer = currentPlayer.value;
}

// Sync currentPlayer + player list when a new map loads
watch(
    game,
    g => {
        if (!g) return;
        currentPlayer.value = g.currentPlayer;
        availablePlayers.value = buildPlayerList(g);
    },
    { immediate: true }
);

// Building placement options
const placeBuildingsCompleted = computed({
    get: () => game.value?.settings.state.placeBuildingsCompleted ?? false,
    set: (value: boolean) => {
        if (game.value) game.value.settings.state.placeBuildingsCompleted = value;
    },
});

const placeBuildingsWithWorker = computed({
    get: () => game.value?.settings.state.placeBuildingsWithWorker ?? false,
    set: (value: boolean) => {
        if (game.value) game.value.settings.state.placeBuildingsWithWorker = value;
    },
});

function setPlaceMode(buildingType: number) {
    setPlaceModeBase(buildingType, currentRace.value);
}

function onRaceChange() {
    // Only switch music — building icons already react to currentRace.
    // We intentionally do NOT call renderer.setRace() here because that
    // would re-skin every building on the map. The race selector only
    // controls which buildings appear in the placement menu.
    SoundManager.getInstance().playRandomMusic(currentRace.value);
    saveSavedRace(currentRace.value);
}

function onResetGameState() {
    resetGameState();
    clearCameraState(getCurrentMapId());
    rendererRef.value?.centerOnPlayerStart?.();
}

// Ticks paused indicator — true when game loop renders but logic ticks are not running
const ticksPaused = computed(() => game.value?.viewState.state.ticksPaused ?? false);

// Key to force renderer recreation when graphics settings change
const rendererKey = ref(0);
const savedCamera = ref<{ x: number; y: number; zoom: number } | null>(null);

// On new map load, clear saved camera so the renderer centers on player start.
// savedCamera is only set during settings recreation (antialias toggle) to preserve position.
// Clearing localStorage ensures loadCameraState also returns null (HMR saves survive otherwise).
watch(game, newGame => {
    savedCamera.value = null;
    if (newGame) clearCameraState(getCurrentMapId());
});

// Save current camera to localStorage (used on unload and antialias recreation)
function persistCamera(): void {
    const mapId = getCurrentMapId();
    const cam = rendererRef.value?.getCamera?.();
    if (cam && mapId) saveCameraState(mapId, cam);
}

// Watch for graphics settings changes that require context recreation
watch(
    () => game.value?.settings.state.antialias,
    () => {
        // Save camera position before recreation (to prop AND localStorage)
        const renderer = rendererRef.value;
        if (renderer && typeof renderer.getCamera === 'function') {
            savedCamera.value = renderer.getCamera();
            persistCamera();
        }
        // Force component recreation by changing key
        rendererKey.value++;
    }
);

// Save camera on page close / SPA navigation away
onMounted(() => window.addEventListener('beforeunload', persistCamera));
onBeforeUnmount(() => {
    persistCamera();
    window.removeEventListener('beforeunload', persistCamera);
});
</script>

<style scoped>
/* ===== ROOT WRAPPER ===== */
.map-view-root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

/* ===== MAIN GAME LAYOUT ===== */
.game-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    background: #0d0a05;
}

/* ===== LEFT SIDEBAR ===== */
.sidebar {
    width: 180px;
    min-width: 180px;
    background: linear-gradient(180deg, #2c1e0e 0%, #1a1209 100%);
    border-right: 3px solid #5c3d1a;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
}

.sidebar-tabs {
    display: flex;
    border-bottom: 2px solid #5c3d1a;
}

.tab-btn {
    flex: 1;
    padding: 6px 4px;
    background: #1a1209;
    color: #8a7040;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    font-size: 13px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition:
        background 0.15s,
        color 0.15s;
}

.tab-btn:hover {
    background: #2c1e0e;
    color: #c8a96e;
}

.tab-btn.active {
    background: #3a2810;
    color: #e8c87e;
    border-bottom-color: #d4a030;
}

.tab-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 2px 6px;
    overflow-y: auto;
}

.building-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    margin-bottom: 4px;
    background: #2c1e0e;
    border: 1px solid #4a3218;
    border-radius: 3px;
    color: #c8a96e;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
}

.building-option:hover {
    background: #3a2810;
    border-color: #6a4a20;
}

.resource-params {
    padding: 8px;
    background: #2c1e0e;
    border-bottom: 1px solid #4a3218;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #c8a96e;
    flex-shrink: 0;
}

.amount-input {
    width: 40px;
    background: #1a1209;
    border: 1px solid #4a3218;
    color: #e8c87e;
    border-radius: 3px;
    padding: 2px 4px;
}

/* ===== SIDEBAR BUTTONS ===== */
.sidebar-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 0 6px;
    background: #2c1e0e;
    color: #c8a96e;
    border: 1px solid #4a3218;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    text-align: left;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.sidebar-btn:hover {
    background: #3a2810;
    border-color: #6a4a20;
}

.sidebar-btn.active {
    background: #4a3518;
    border-color: #d4a030;
    color: #ffe8a0;
    box-shadow: inset 0 0 8px rgba(212, 160, 48, 0.2);
}

.sidebar-btn:disabled {
    opacity: 0.35;
    cursor: default;
}

.btn-icon {
    font-size: 14px;
    width: 56px;
    height: 56px;
    text-align: center;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle, rgba(212, 160, 48, 0.35) 0%, rgba(212, 160, 48, 0.08) 60%, transparent 100%);
    border-radius: 3px;
}

.building-icon-img {
    object-fit: contain;
}

.sidebar-btn.active .btn-icon {
    background: radial-gradient(circle, rgba(212, 160, 48, 0.3) 0%, transparent 70%);
}

.sidebar-btn.active .building-icon-img {
    filter: brightness(1.3) drop-shadow(0 0 3px #ffd700);
}

.resource-icon {
    max-width: 52px;
    max-height: 52px;
    object-fit: contain;
    filter: drop-shadow(1px 1px 0 rgba(0, 0, 0, 0.5));
}

.btn-label {
    flex: 1;
}

/* ===== CANVAS AREA ===== */
.canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
}

.info-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 6px 12px;
    background: #1a1209;
    border-bottom: 2px solid #5c3d1a;
    align-items: center;
    z-index: 10;
}

.map-selector {
    display: flex;
    align-items: center;
    gap: 8px;
}

.info-label {
    font-weight: bold;
    color: #d4b27a;
    font-size: 13px;
}

.no-game-fallback {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.mode-indicator {
    padding: 3px 8px;
    background: #2c1e0e;
    border: 1px solid #4a3218;
    border-radius: 3px;
    color: #c8a96e;
    font-size: 12px;
}

.mode-indicator strong {
    color: #e8c87e;
}

.tile-info,
.entity-info {
    padding: 3px 8px;
    background: #1a2a1a;
    border: 1px solid #2a4a2a;
    border-radius: 3px;
    color: #80c080;
    font-size: 12px;
}

.sidebar-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 8px;
    background: #1a1209;
    border-bottom: 1px solid #3a2810;
    color: #c8a96e;
    font-size: 13px;
}

.sidebar-selector + .sidebar-tabs {
    border-top: 1px solid #5c3d1a;
}

.sidebar-selector label {
    font-weight: bold;
    color: #d4b27a;
    width: 46px;
    flex-shrink: 0;
}

.sidebar-selector select {
    flex: 1;
    min-width: 0;
    background: #2c1e0e;
    color: #c8a96e;
    border: 1px solid #4a3218;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 13px;
    cursor: pointer;
}

.sidebar-selector select:hover {
    border-color: #6a4a20;
    background: #3a2810;
}

/* Canvas fills remaining space */
.game-canvas {
    flex: 1;
    min-height: 0;
}

/* Left panels container (selection info) — positioned below the info bar */
.left-panels {
    position: absolute;
    top: 44px;
    left: 8px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    z-index: 100;
    max-height: calc(100% - 52px);
    pointer-events: none;
}

/* Right panels container */
.right-panels {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    z-index: 100;
    max-height: calc(100% - 16px);
    pointer-events: none;
}

.game-canvas :deep(.cav) {
    width: 100%;
    height: 100%;
    display: block;
    margin: 0;
    border: none;
}

/* Stale save data warning modal */
.stale-save-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
}

.stale-save-dialog {
    background: #1a1209;
    border: 2px solid #c8a24e;
    border-radius: 8px;
    padding: 28px 36px;
    max-width: 440px;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.stale-save-title {
    color: #f0c040;
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 12px;
}

.stale-save-message {
    color: #d4c4a0;
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 20px;
}

.stale-save-actions {
    display: flex;
    justify-content: center;
    gap: 12px;
}

.stale-save-btn {
    padding: 8px 20px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s;
}

.stale-save-btn--discard {
    background: #c84040;
    color: #fff;
    border-color: #e05050;
}

.stale-save-btn--discard:hover {
    background: #e04848;
}

/* Ticks-paused warning overlay */
.ticks-paused-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 48px;
    font-weight: 900;
    letter-spacing: 6px;
    color: rgba(255, 60, 60, 0.7);
    text-shadow:
        0 0 20px rgba(0, 0, 0, 0.8),
        0 2px 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    z-index: 200;
    user-select: none;
    animation: pulse-pause 2s ease-in-out infinite;
}

@keyframes pulse-pause {
    0%,
    100% {
        opacity: 0.7;
    }
    50% {
        opacity: 0.3;
    }
}

/* ===== SCROLLBAR ===== */
.sidebar::-webkit-scrollbar {
    width: 6px;
}

.sidebar::-webkit-scrollbar-track {
    background: #1a1209;
}

.sidebar::-webkit-scrollbar-thumb {
    background: #4a3218;
    border-radius: 3px;
}

.sidebar::-webkit-scrollbar-thumb:hover {
    background: #5c3d1a;
}
</style>

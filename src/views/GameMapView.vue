<template>
    <div class="game-layout" data-testid="game-ui" @mouseup="blurNonTextInput" @change="blurNonTextInput">
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
                <button class="tab-btn" :class="{ active: activeTab === 'buildings' }" @click="activeTab = 'buildings'">
                    Build
                </button>
                <button class="tab-btn" :class="{ active: activeTab === 'units' }" @click="activeTab = 'units'">
                    Units
                </button>
                <button class="tab-btn" :class="{ active: activeTab === 'resources' }" @click="activeTab = 'resources'">
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
                        @select="$emit('fileSelect', $event)"
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
                :layerVisibility="layerVisibility"
                :initialCamera="savedCamera"
                @tileClick="onTileClick"
                class="game-canvas"
            />

            <!-- "Ticks paused" overlay — visible when game loop renders but ticks don't -->
            <div v-if="ticksPaused && !staleSnapshotWarning" class="ticks-paused-overlay">TICKS PAUSED</div>

            <!-- Stale save data warning — blocks interaction until user decides -->
            <div v-if="staleSnapshotWarning" class="stale-save-backdrop">
                <div class="stale-save-dialog">
                    <h2 class="stale-save-title">Incompatible Save Data</h2>
                    <p class="stale-save-message">
                        A saved game was found, but it was created with an older version and can no longer be loaded.
                        The game is paused until you decide.
                    </p>
                    <div class="stale-save-actions">
                        <button class="stale-save-btn stale-save-btn--discard" @click="$emit('dismissStaleSnapshot')">
                            Discard &amp; Start Fresh
                        </button>
                    </div>
                </div>
            </div>

            <!-- Game end (victory / defeat) overlay -->
            <div v-if="gameEndResult" class="game-end-backdrop">
                <div class="game-end-dialog">
                    <h2
                        class="game-end-title"
                        :class="gameEndResult.won ? 'game-end-title--won' : 'game-end-title--lost'"
                    >
                        {{ gameEndResult.won ? 'Victory!' : 'Defeat' }}
                    </h2>
                    <p class="game-end-message">
                        {{
                            gameEndResult.won
                                ? 'All enemies have been eliminated. The land is yours.'
                                : 'Your settlements have fallen. The enemy has prevailed.'
                        }}
                    </p>
                    <div class="game-end-actions">
                        <button class="game-end-btn game-end-btn--continue" @click="dismissGameEnd">Continue</button>
                        <button class="game-end-btn game-end-btn--quit" @click="$router.push('/')">Quit</button>
                    </div>
                </div>
            </div>

            <!-- Left panel container (minimap + selection info) -->
            <div class="left-panels">
                <game-minimap
                    :game="game"
                    :get-camera="() => rendererRef?.getCamera?.() ?? null"
                    :navigate-to-tile="(x: number, y: number) => rendererRef?.setCameraPosition?.(x, y)"
                />
                <selection-panel :game="game" :unit-icons="unitIcons" />
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
</template>

<script setup lang="ts">
import { ref, computed, useTemplateRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { Game } from '@/game/game';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { Race, formatRace, AVAILABLE_RACES, loadSavedRace, saveSavedRace } from '@/game/renderer/sprite-metadata';
import { SoundManager } from '@/game/audio/sound-manager';
import { saveCameraState, clearCameraState } from '@/game/renderer/camera-persistence';
import { getCurrentMapId } from '@/game/state/game-state-persistence';
import { saveLayerVisibility } from '@/game/renderer/layer-visibility';
import { BuildingType, UnitType } from '@/game/entity';
import type { EMaterialType } from '@/game/economy';
import { GameEndReason } from '@/game/features/victory-conditions/victory-conditions-system';
import { toastInfo } from '@/game/ui/toast-notifications';
import { ALL_RESOURCES } from './palette-data';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';
import SelectionPanel from '@/components/selection-panel.vue';
import TabbedPanel from '@/components/TabbedPanel.vue';
import Checkbox from '@/components/Checkbox.vue';
import SpecialistsPanel from '@/components/SpecialistsPanel.vue';
import GameMinimap from '@/components/game-minimap.vue';

import { setupUIState, setupComputedState } from './use-map-view-state';
import { createModeToggler, createGameActions, setupIconLoading } from './use-map-view-helpers';

const props = defineProps<{
    game: Game;
    fileManager: FileManager;
    staleSnapshotWarning: boolean;
}>();

defineEmits<{
    (e: 'fileSelect', file: IFileSource): void;
    (e: 'dismissStaleSnapshot'): void;
}>();

const { game, fileManager } = props;

// Template ref for renderer
const rendererRef = useTemplateRef<InstanceType<typeof RendererViewer>>('rendererRef');

// Player & race selection
const currentPlayer = ref(game.currentPlayer);
const currentRace = ref<Race>(loadSavedRace());

// =========================================================================
// UI State (icons, layer visibility, tabs)
// =========================================================================

const {
    activeTab,
    resourceAmount,
    hoveredTile,
    resourceIcons,
    buildingIcons,
    unitIcons,
    specialistIcons,
    layerVisibility,
    updateLayerVisibility,
} = setupUIState();

// Wire territory feature toggle to sync with layer visibility
game.onTerritoryToggle(enabled => {
    layerVisibility.showTerritory = enabled;
    saveLayerVisibility(layerVisibility);
});

// =========================================================================
// Computed State (derived from non-null game)
// =========================================================================

const {
    selectedEntity,
    selectionCount,
    currentPlayerRace,
    availableBuildings,
    availableUnits,
    currentMode,
    placeBuildingType,
    placeResourceType,
    placeUnitType,
    layerCounts,
} = setupComputedState(game, currentRace);

// isPaused is a local ref — game.isRunning is NOT a Vue reactive property (it's a plain
// boolean on GameLoop), so a computed would never re-evaluate. Instead we update it
// explicitly when togglePause is called.
const isPaused = ref(!game.isRunning);

// =========================================================================
// Mode & Action Handlers
// =========================================================================

// eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
const getInputManager = () => rendererRef.value?.getInputManager?.() ?? null;

const modeToggler = createModeToggler(game, getInputManager);
const gameActions = createGameActions(game);

const setPlaceMode = (buildingType: BuildingType) => modeToggler.setPlaceMode(buildingType, currentRace.value);
const setPlaceResourceMode = (rt: EMaterialType) => modeToggler.setPlacePileMode(rt, resourceAmount.value);
const setPlaceUnitMode = (ut: UnitType) => modeToggler.setPlaceUnitMode(ut, currentPlayerRace.value);
function togglePause() {
    gameActions.togglePause();
    isPaused.value = !game.isRunning;
}

// Update resource placement mode when amount changes
watch(resourceAmount, () => {
    if (game.viewState.state.mode === 'place_pile' && game.viewState.state.placePileType) {
        const inputManager = getInputManager();
        if (inputManager) {
            inputManager.switchMode('place_pile', {
                resourceType: game.viewState.state.placePileType,
                amount: resourceAmount.value,
            });
        }
    }
});

function onTileClick(tile: { x: number; y: number }) {
    hoveredTile.value = tile;
}

// =========================================================================
// Resources available in the UI
// =========================================================================

const availableResources = ALL_RESOURCES;

// =========================================================================
// Building placement options (two-way computed, game is non-null)
// =========================================================================

const placeBuildingsCompleted = computed({
    get: () => game.settings.state.placeBuildingsCompleted,
    set: (value: boolean) => {
        game.settings.state.placeBuildingsCompleted = value;
    },
});

const placeBuildingsWithWorker = computed({
    get: () => game.settings.state.placeBuildingsWithWorker,
    set: (value: boolean) => {
        game.settings.state.placeBuildingsWithWorker = value;
    },
});

// =========================================================================
// Player & Race
// =========================================================================

const availableRaces = AVAILABLE_RACES.map(race => ({
    value: race,
    name: formatRace(race),
}));

const availablePlayers = ref(buildPlayerList(game));

function buildPlayerList(g: Game): { index: number; label: string }[] {
    if (g.playerRaces.size === 0) {
        throw new Error('No player data in loaded map — playerRaces is empty');
    }
    const players: { index: number; label: string }[] = [];
    for (const [idx, race] of g.playerRaces) {
        players.push({ index: idx, label: `P${idx} ${formatRace(race)}` });
    }
    players.sort((a, b) => a.index - b.index);
    return players;
}

function onPlayerChange() {
    game.currentPlayer = currentPlayer.value;
}

function onRaceChange() {
    SoundManager.getInstance().playRandomMusic(currentRace.value);
    saveSavedRace(currentRace.value);
}

// =========================================================================
// Renderer Camera & Recreation
// =========================================================================

const rendererKey = ref(0);
const savedCamera = ref<{ x: number; y: number; zoom: number } | null>(null);

function persistCamera(): void {
    const mapId = getCurrentMapId();
    const cam = rendererRef.value?.getCamera?.();
    if (cam && mapId) {
        saveCameraState(mapId, cam);
    }
}

// Watch for graphics settings changes that require context recreation
watch(
    () => game.settings.state.antialias,
    () => {
        const renderer = rendererRef.value;
        if (renderer && typeof renderer.getCamera === 'function') {
            savedCamera.value = renderer.getCamera();
            persistCamera();
        }
        rendererKey.value++;
    }
);

onMounted(() => window.addEventListener('beforeunload', persistCamera));
onBeforeUnmount(() => {
    persistCamera();
    window.removeEventListener('beforeunload', persistCamera);
});

// =========================================================================
// Ticks paused indicator
// =========================================================================

const ticksPaused = computed(() => game.viewState.state.ticksPaused);

// =========================================================================
// Game End (victory / defeat) overlay
// =========================================================================

const gameEndResult = ref<{ won: boolean; reason: GameEndReason } | null>(null);

function onGameEnded({ winner, reason }: { winner: number | null; reason: string }): void {
    gameEndResult.value = { won: winner !== null, reason: reason as GameEndReason };
}

function onStateRestored(): void {
    gameEndResult.value = null;
}

function onPlayerEliminated({ player }: { player: number }): void {
    if (player === game.currentPlayer) {
        return; // The game-end overlay handles the local player's defeat
    }
    toastInfo(`Player ${player + 1} has been eliminated`, 8000);
}

game.eventBus.on('game:ended', onGameEnded);
game.eventBus.on('game:playerEliminated', onPlayerEliminated);
game.eventBus.on('game:stateRestored', onStateRestored);

onBeforeUnmount(() => {
    game.eventBus.off('game:ended', onGameEnded);
    game.eventBus.off('game:playerEliminated', onPlayerEliminated);
    game.eventBus.off('game:stateRestored', onStateRestored);
});

const dismissGameEnd = () => {
    gameEndResult.value = null;
};

// =========================================================================
// Reset & Miscellaneous
// =========================================================================

function onResetGameState() {
    gameActions.resetGameState();
    clearCameraState(getCurrentMapId());
    rendererRef.value?.centerOnPlayerStart?.();
}

/** Blur non-text inputs after interaction so keyboard focus returns to the game. */
function blurNonTextInput(e: Event): void {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
        return;
    }
    const tag = active.tagName;
    const isNonText =
        tag === 'SELECT' || tag === 'BUTTON' || (tag === 'INPUT' && (active as HTMLInputElement).type === 'checkbox');
    if (!isNonText) {
        return;
    }

    if (e.type === 'change') {
        void nextTick(() => active.blur());
    } else if (e.type === 'mouseup' && e.target !== active) {
        active.blur();
    }
}

// =========================================================================
// Icon Loading
// =========================================================================

setupIconLoading(game, () => fileManager, currentPlayerRace, resourceIcons, buildingIcons, unitIcons, specialistIcons);
</script>

<style scoped src="./game-map-view.css"></style>

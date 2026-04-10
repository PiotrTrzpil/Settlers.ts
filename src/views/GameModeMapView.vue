<template>
    <div class="game-mode-layout" @mouseup="blurNonTextInput" @change="blurNonTextInput">
        <!-- LEFT SIDEBAR — buildings + specialists only -->
        <aside class="gm-sidebar">
            <div class="gm-sidebar-tabs">
                <button
                    class="gm-tab-btn"
                    :class="{ active: activeTab === 'buildings' }"
                    @click="activeTab = 'buildings'"
                >
                    Build
                </button>
                <button
                    class="gm-tab-btn"
                    :class="{ active: activeTab === 'specialists' }"
                    @click="activeTab = 'specialists'"
                >
                    SP
                </button>
            </div>

            <!-- Buildings tab -->
            <div v-if="activeTab === 'buildings'" class="gm-tab-content">
                <button
                    v-for="b in availableBuildings"
                    :key="b.type"
                    class="gm-sidebar-btn"
                    :class="{ active: currentMode === 'place_building' && placeBuildingType === b.type }"
                    @click="setPlaceMode(b.type)"
                >
                    <span class="gm-btn-icon">
                        <img
                            v-if="buildingIcons[b.type]"
                            :src="buildingIcons[b.type]!.url"
                            :alt="b.name"
                            class="gm-icon-img"
                            :style="{
                                width: buildingIcons[b.type]!.size + 'px',
                                height: buildingIcons[b.type]!.size + 'px',
                            }"
                        />
                        <span v-else>{{ b.icon }}</span>
                    </span>
                    <span class="gm-btn-label">{{ b.name }}</span>
                </button>
            </div>

            <!-- Specialists tab -->
            <div v-if="activeTab === 'specialists'" class="gm-tab-content">
                <specialists-panel
                    :game="game"
                    :race="playerRace"
                    :specialist-icons="specialistIcons"
                    :get-camera-center="() => rendererRef?.getCamera?.() ?? null"
                />
            </div>
        </aside>

        <!-- MAIN CANVAS AREA -->
        <div class="gm-canvas-area">
            <renderer-viewer ref="rendererRef" :game="game" :layerVisibility="layerVisibility" class="gm-canvas" />

            <!-- Game end overlay -->
            <div v-if="gameEndResult && !showStats" class="game-end-backdrop">
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
                        <button class="game-end-btn game-end-btn--continue" @click="gameEndResult = null">
                            Continue
                        </button>
                        <button class="game-end-btn game-end-btn--stats" @click="showStats = true">View Stats</button>
                    </div>
                </div>
            </div>

            <!-- Post-game stats screen -->
            <game-stats-screen
                v-if="showStats"
                :game="game"
                :won="gameEndResult?.won ?? null"
                :stats-tracker="statsTracker"
                @quit="$router.push('/')"
            />

            <!-- Stale save warning -->
            <div v-if="staleSnapshotWarning" class="game-end-backdrop">
                <div class="game-end-dialog">
                    <h2 class="game-end-title game-end-title--lost">Incompatible Save Data</h2>
                    <p class="game-end-message">
                        A saved game was found, but it was created with an older version and can no longer be loaded.
                    </p>
                    <div class="game-end-actions">
                        <button class="game-end-btn game-end-btn--quit" @click="$emit('dismissStaleSnapshot')">
                            Discard &amp; Start Fresh
                        </button>
                    </div>
                </div>
            </div>

            <!-- Left floating panels: minimap + selection -->
            <div class="gm-left-panels">
                <game-minimap
                    :game="game"
                    :get-camera="() => rendererRef?.getCamera?.() ?? null"
                    :navigate-to-tile="(x: number, y: number) => rendererRef?.setCameraPosition?.(x, y)"
                />
                <selection-panel :game="game" :unit-icons="unitIcons" />
            </div>

            <!-- Right floating panel: speed + save/load controls -->
            <div class="gm-right-panels">
                <button class="gm-panel-toggle" @click="rightPanelOpen = !rightPanelOpen">
                    {{ rightPanelOpen ? '&#9654;' : '&#9664;' }}
                </button>
                <div v-if="rightPanelOpen" class="gm-controls-panel">
                    <button class="gm-pause-btn" :class="{ paused: isPaused }" @click="togglePause">
                        {{ isPaused ? '&#9654;' : '&#10074;&#10074;' }}
                    </button>
                    <div class="gm-speed-row">
                        <button
                            v-for="s in SPEED_OPTIONS"
                            :key="s"
                            class="gm-speed-btn"
                            :class="{ active: currentSpeed === s }"
                            :disabled="isPaused"
                            @click="setSpeed(s)"
                        >
                            {{ s }}x
                        </button>
                    </div>
                    <div class="gm-divider" />
                    <button class="gm-menu-btn" @click="showSaveLoad = true">Save / Load</button>
                    <button class="gm-menu-btn gm-menu-btn--danger" @click="showRestartConfirm = true">
                        Restart Map
                    </button>
                    <button class="gm-menu-btn gm-menu-btn--danger" @click="showExitConfirm = true">Exit Game</button>
                </div>
            </div>

            <!-- Restart confirmation -->
            <div v-if="showRestartConfirm" class="game-end-backdrop">
                <div class="game-end-dialog">
                    <h2 class="game-end-title game-end-title--lost">Restart Map?</h2>
                    <p class="game-end-message">
                        This will reset the map to its initial state. All unsaved progress will be lost.
                    </p>
                    <div class="game-end-actions">
                        <button class="game-end-btn game-end-btn--continue" @click="showRestartConfirm = false">
                            Cancel
                        </button>
                        <button class="game-end-btn game-end-btn--quit" @click="doRestartMap">Restart</button>
                    </div>
                </div>
            </div>

            <!-- Exit confirmation -->
            <div v-if="showExitConfirm" class="game-end-backdrop">
                <div class="game-end-dialog">
                    <h2 class="game-end-title game-end-title--lost">Exit Game?</h2>
                    <p class="game-end-message">
                        Do you want to view game stats before leaving? Unsaved progress will be lost.
                    </p>
                    <div class="game-end-actions">
                        <button class="game-end-btn game-end-btn--continue" @click="showExitConfirm = false">
                            Cancel
                        </button>
                        <button
                            class="game-end-btn game-end-btn--stats"
                            @click="
                                showExitConfirm = false;
                                showStats = true;
                            "
                        >
                            View Stats
                        </button>
                        <button class="game-end-btn game-end-btn--quit" @click="$router.push('/')">Quit Now</button>
                    </div>
                </div>
            </div>

            <!-- Save/Load dialog -->
            <save-load-dialog
                v-if="showSaveLoad"
                :save-manager="saveManager"
                @close="showSaveLoad = false"
                @loaded="onSaveLoaded"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, useTemplateRef, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { Game } from '@/game/game';
import { Race } from '@/game/core/race';
import { BuildingType } from '@/game/entity';
import { GameEndReason } from '@/game/features/victory-conditions/victory-conditions-system';
import { isBuildingAvailableForRace } from '@/game/data/race-availability';
import { loadLayerVisibility } from '@/game/renderer/layer-visibility';
import { clearCameraState } from '@/game/renderer/camera-persistence';
import { getCurrentMapId } from '@/game/state/game-state-persistence';
import { toastInfo } from '@/game/ui/toast-notifications';
import { ALL_BUILDINGS } from './palette-data';

import RendererViewer from '@/components/renderer-viewer.vue';
import SelectionPanel from '@/components/selection-panel.vue';
import SpecialistsPanel from '@/components/SpecialistsPanel.vue';
import GameMinimap from '@/components/game-minimap.vue';
import SaveLoadDialog from '@/components/SaveLoadDialog.vue';
import GameStatsScreen from '@/components/GameStatsScreen.vue';

import { createModeToggler, createGameActions, setupIconLoading } from './use-map-view-helpers';
import type { IconEntry } from './sprite-icon-loader';
import type { GameModeSaveManager } from '@/game/state/game-mode-saves';
import type { GameModeStatsTracker } from '@/game/state/game-mode-stats-tracker';

const SPEED_OPTIONS = [0.5, 1, 2, 3] as const;

const props = defineProps<{
    game: Game;
    fileManager: import('@/utilities/file-manager').FileManager;
    staleSnapshotWarning: boolean;
    saveManager: GameModeSaveManager;
    statsTracker: GameModeStatsTracker;
}>();

defineEmits<{
    (e: 'dismissStaleSnapshot'): void;
}>();

const { saveManager } = props;

const { game, fileManager } = props;

const rendererRef = useTemplateRef<InstanceType<typeof RendererViewer>>('rendererRef');

// Player race derived from the game's map data
const playerRace = computed(() => game.playerRaces.get(game.currentPlayer) ?? Race.Roman);

// Sidebar tabs — only buildings and specialists in game mode
const activeTab = ref<'buildings' | 'specialists'>('buildings');

// Force normal construction in game mode (no dev shortcuts)
game.settings.state.placeBuildingsCompleted = false;
game.settings.state.placeBuildingsWithWorker = false;

// Layer visibility — use saved defaults, no layer panel to toggle
const layerVisibility = reactive(loadLayerVisibility());

// Available buildings filtered by race
const availableBuildings = computed(() =>
    ALL_BUILDINGS.filter(b => isBuildingAvailableForRace(b.type, playerRace.value))
);

// Mode state
const currentMode = computed(() => game.viewState.state.mode);
const placeBuildingType = computed(() => game.viewState.state.placeBuildingType);

// Icons
const buildingIcons = ref<Partial<Record<BuildingType, IconEntry>>>({});
const unitIcons = ref<Record<string, IconEntry>>({});
const specialistIcons = ref<Record<string, IconEntry>>({});
const resourceIcons = ref<Record<string, string>>({});

setupIconLoading(game, () => fileManager, playerRace, resourceIcons, buildingIcons, unitIcons, specialistIcons);

// Mode toggling
// eslint-disable-next-line no-restricted-syntax -- optional chaining; null when renderer absent
const getInputManager = () => rendererRef.value?.getInputManager?.() ?? null;
const modeToggler = createModeToggler(game, getInputManager);
const gameActions = createGameActions(game);
const setPlaceMode = (buildingType: BuildingType) => modeToggler.setPlaceMode(buildingType, playerRace.value);

// Speed and pause controls — always start at 1x in game mode
const isPaused = ref(game.settings.state.paused);
const currentSpeed = ref(1);
game.settings.state.gameSpeed = 1;

function togglePause(): void {
    game.settings.state.paused = !game.settings.state.paused;
    isPaused.value = game.settings.state.paused;
}

function setSpeed(speed: number): void {
    currentSpeed.value = speed;
    game.settings.state.gameSpeed = speed;
}

// Spacebar pause toggle
function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePause();
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKeyDown);
});

// Right panel collapse
const rightPanelOpen = ref(true);

// Save/Load dialog
const showSaveLoad = ref(false);

function onSaveLoaded(): void {
    gameEndResult.value = null;
}

// Exit / Restart confirmations
const showExitConfirm = ref(false);
const showRestartConfirm = ref(false);

function doRestartMap(): void {
    showRestartConfirm.value = false;
    gameActions.resetGameState();
    clearCameraState(getCurrentMapId());
    rendererRef.value?.centerOnPlayerStart?.();
    gameEndResult.value = null;
}

// Game end overlay + stats screen
const showStats = ref(false);
const gameEndResult = ref<{ won: boolean; reason: GameEndReason } | null>(null);

function onGameEnded({ winner, reason }: { winner: number | null; reason: string }): void {
    gameEndResult.value = { won: winner !== null, reason: reason as GameEndReason };
}

function onPlayerEliminated({ player }: { player: number }): void {
    if (player === game.currentPlayer) {
        return;
    }
    toastInfo(`Player ${player + 1} has been eliminated`, 8000);
}

function onStateRestored(): void {
    gameEndResult.value = null;
}

game.eventBus.on('game:ended', onGameEnded);
game.eventBus.on('game:playerEliminated', onPlayerEliminated);
game.eventBus.on('game:stateRestored', onStateRestored);

onBeforeUnmount(() => {
    game.eventBus.off('game:ended', onGameEnded);
    game.eventBus.off('game:playerEliminated', onPlayerEliminated);
    game.eventBus.off('game:stateRestored', onStateRestored);
    window.removeEventListener('keydown', onKeyDown);
});

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
</script>

<style scoped src="./game-mode-map-view.css"></style>

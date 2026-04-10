import { watch, onMounted, onBeforeUnmount, type Ref, type ShallowRef } from 'vue';
import type { Game } from '@/game/game';
import { BuildingType, UnitType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { EMaterialType } from '@/game/economy';
import type { FileManager } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import type { InputManager } from '@/game/input';
import { loadBuildingIcons, loadResourceIcons, loadUnitIcons, type IconEntry } from './sprite-icon-loader';
import { gameStatePersistence, clearSavedGameState } from '@/game/state/game-state-persistence';
import { ALL_BUILDINGS, ALL_UNITS, ALL_RESOURCES, ALL_SPECIALISTS } from './palette-data';
import { toastError } from '@/game/ui/toast-notifications';

const log = new LogHandler('MapView');

/** Resources available in the UI (re-exported from palette-data) */
const availableResources = ALL_RESOURCES;

/** Create mode toggle handler. Game is guaranteed non-null. */
export function createModeToggler(game: Game, getInputManager: () => InputManager | null) {
    return {
        setPlaceMode(buildingType: BuildingType, race: Race): void {
            const inputManager = getInputManager();
            if (!inputManager) {
                return;
            }

            if (
                game.viewState.state.mode === 'place_building' &&
                game.viewState.state.placeBuildingType === buildingType
            ) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_building', {
                    buildingType,
                    player: game.currentPlayer,
                    race,
                });
            }
        },

        setPlacePileMode(resourceType: EMaterialType, amount: number): void {
            const inputManager = getInputManager();
            if (!inputManager) {
                return;
            }

            if (game.viewState.state.mode === 'place_pile' && game.viewState.state.placePileType === resourceType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_pile', { resourceType, amount });
            }
        },

        setPlaceUnitMode(unitType: UnitType, race: Race): void {
            const inputManager = getInputManager();
            if (!inputManager) {
                return;
            }

            const vs = game.viewState.state;
            if (vs.mode === 'place_unit' && vs.placeUnitType === unitType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_unit', { unitType, race, player: game.currentPlayer });
            }
        },

        setSelectMode(): void {
            getInputManager()?.switchMode('select');
        },
    };
}

/** Create game action handlers. Game is guaranteed non-null. */
export function createGameActions(game: Game) {
    return {
        removeSelected(): void {
            if (game.state.selection.selectedEntityId === null) {
                return;
            }
            game.execute({ type: 'remove_entity', entityId: game.state.selection.selectedEntityId });
        },

        togglePause(): void {
            if (game.isRunning) {
                game.stop();
            } else {
                game.start();
            }
        },

        resetGameState(): void {
            try {
                void clearSavedGameState();
                game.restoreToInitialState();
                log.info('Game state reset to initial map state');
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                toastError('Reset', err.message);
                log.error('Failed to reset game state:', err);
            }
        },
    };
}

/** Set up icon loading: load icons immediately and when race changes. */
export function setupIconLoading(
    game: Game,
    getFileManager: () => FileManager,
    currentPlayerRace: Ref<Race>,
    resourceIcons: Ref<Record<string, string>>,
    buildingIcons: Ref<Record<number, IconEntry>>,
    unitIcons: Ref<Record<string, IconEntry>>,
    specialistIcons: Ref<Record<string, IconEntry>>
): void {
    // Load icons immediately — game is guaranteed to exist
    const fm = getFileManager();
    void loadResourceIcons(fm, availableResources).then(icons => {
        resourceIcons.value = icons;
    });
    void loadBuildingIcons(fm, currentPlayerRace.value, ALL_BUILDINGS).then(icons => {
        buildingIcons.value = icons;
    });
    void loadUnitIcons(fm, currentPlayerRace.value, ALL_UNITS).then(icons => {
        unitIcons.value = icons;
    });
    void loadUnitIcons(fm, currentPlayerRace.value, ALL_SPECIALISTS).then(icons => {
        specialistIcons.value = icons;
    });

    watch(currentPlayerRace, race => {
        void loadBuildingIcons(getFileManager(), race, ALL_BUILDINGS).then(icons => {
            buildingIcons.value = icons;
        });
        void loadUnitIcons(getFileManager(), race, ALL_UNITS).then(icons => {
            unitIcons.value = icons;
        });
        void loadUnitIcons(getFileManager(), race, ALL_SPECIALISTS).then(icons => {
            specialistIcons.value = icons;
        });
    });
}

/** Register mount/unmount hooks for game lifecycle (used by parent map-view). */
export function setupLifecycle(game: ShallowRef<Game | null>, initializeMap: () => void): void {
    onMounted(() => initializeMap());
    onBeforeUnmount(() => {
        if (!game.value) {
            return;
        }
        gameStatePersistence.stop();
        game.value.destroy();
        game.value = null;
    });
}

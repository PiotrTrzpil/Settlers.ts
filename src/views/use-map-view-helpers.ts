import { triggerRef, watch, onMounted, onBeforeUnmount, type Ref, type ShallowRef } from 'vue';
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

/** Create mode toggle handler */
export function createModeToggler(getGame: () => Game | null, getInputManager: () => InputManager | null) {
    return {
        setPlaceMode(buildingType: BuildingType, race: number): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) {
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
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) {
                return;
            }

            if (game.viewState.state.mode === 'place_pile' && game.viewState.state.placePileType === resourceType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_pile', { resourceType, amount });
            }
        },

        setPlaceUnitMode(unitType: UnitType, race: Race): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) {
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

/** Create game action handlers */
export function createGameActions(getGame: () => Game | null, game: ShallowRef<Game | null>) {
    return {
        removeSelected(): void {
            const g = getGame();
            if (!g || g.state.selection.selectedEntityId === null) {
                return;
            }
            g.execute({ type: 'remove_entity', entityId: g.state.selection.selectedEntityId });
            triggerRef(game);
        },

        togglePause(): void {
            const g = getGame();
            if (!g) {
                return;
            }
            if (g.isRunning) {
                g.stop();
            } else {
                g.start();
            }
        },

        resetGameState(): void {
            const g = getGame();
            if (!g) {
                return;
            }

            try {
                clearSavedGameState();
                g.restoreToInitialState();
                log.info('Game state reset to initial map state');
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                toastError('Reset', err.message);
                log.error('Failed to reset game state:', err);
                return;
            }

            triggerRef(game);
        },
    };
}

/** Set up icon loading watches: load icons when game or race changes */
export function setupIconLoading(
    game: ShallowRef<Game | null>,
    getFileManager: () => FileManager,
    currentPlayerRace: Ref<Race>,
    resourceIcons: Ref<Record<string, string>>,
    buildingIcons: Ref<Record<number, IconEntry>>,
    unitIcons: Ref<Record<string, IconEntry>>,
    specialistIcons: Ref<Record<string, IconEntry>>
): void {
    watch(game, g => {
        if (g) {
            void loadResourceIcons(getFileManager(), availableResources).then(icons => {
                resourceIcons.value = icons;
            });
            void loadBuildingIcons(getFileManager(), currentPlayerRace.value, ALL_BUILDINGS).then(icons => {
                buildingIcons.value = icons;
            });
            void loadUnitIcons(getFileManager(), currentPlayerRace.value, ALL_UNITS).then(icons => {
                unitIcons.value = icons;
            });
            void loadUnitIcons(getFileManager(), currentPlayerRace.value, ALL_SPECIALISTS).then(icons => {
                specialistIcons.value = icons;
            });
        }
    });

    watch(currentPlayerRace, race => {
        if (game.value) {
            void loadBuildingIcons(getFileManager(), race, ALL_BUILDINGS).then(icons => {
                buildingIcons.value = icons;
            });
            void loadUnitIcons(getFileManager(), race, ALL_UNITS).then(icons => {
                unitIcons.value = icons;
            });
            void loadUnitIcons(getFileManager(), race, ALL_SPECIALISTS).then(icons => {
                specialistIcons.value = icons;
            });
        }
    });
}

/** Register mount/unmount hooks for game lifecycle. */
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

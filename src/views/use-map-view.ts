import {
    ref,
    shallowRef,
    triggerRef,
    computed,
    watch,
    onMounted,
    onBeforeUnmount,
    reactive,
    type Ref,
    type ShallowRef,
} from 'vue';
import { useRoute } from 'vue-router';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { createTestMapLoader, createEmptyMapLoader } from '@/game/test-map-factory';
import { Entity, TileCoord, UnitType } from '@/game/entity';
import { isUnitAvailableForRace, isBuildingAvailableForRace } from '@/game/data/race-availability';
import { Race } from '@/game/core/race';
import type { EMaterialType } from '@/game/economy';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import { LayerVisibility, loadLayerVisibility, saveLayerVisibility } from '@/game/renderer/layer-visibility';
import type { InputManager } from '@/game/input';
import { loadBuildingIcons, loadResourceIcons, loadUnitIcons, type IconEntry } from './sprite-icon-loader';
import { debugStats } from '@/game/debug/debug-stats';
import {
    gameStatePersistence,
    restoreFromSnapshot,
    clearSavedGameState,
    checkSavedSnapshot,
    setCurrentMapId,
    saveInitialState,
} from '@/game/state/game-state-persistence';
import { ALL_BUILDINGS, ALL_UNITS, ALL_RESOURCES, ALL_SPECIALISTS } from './palette-data';
import { toastError } from '@/game/ui/toast-notifications';
import { getGameDataLoader } from '@/resources/game-data';

/** Entity counts per layer for display in the layer panel */
export interface LayerCounts {
    buildings: number;
    units: number;
    piles: number;
    environment: number;
    trees: number;
    stones: number;
    plants: number;
    other: number;
}

const EMPTY_COUNTS: LayerCounts = {
    buildings: 0,
    units: 0,
    piles: 0,
    environment: 0,
    trees: 0,
    stones: 0,
    plants: 0,
    other: 0,
};

const log = new LogHandler('MapView');

/** Check if Lua scripting is enabled in localStorage */
function isLuaEnabled(): boolean {
    try {
        return localStorage.getItem('settlers_luaEnabled') === 'true';
    } catch {
        return false;
    }
}

/** Create a test map Game instance */
function createTestGame(fileManager: FileManager): Game {
    const mapContent = createTestMapLoader();
    const g = new Game(fileManager, mapContent);
    g.useProceduralTextures = true;
    return g;
}

/** Create a flat empty map Game instance (for entity catalog tests with real sprites) */
function createEmptyMapGame(fileManager: FileManager): Game {
    const mapContent = createEmptyMapLoader();
    return new Game(fileManager, mapContent);
}

/** Load a map file and create a Game instance */
async function loadMapFile(
    file: IFileSource,
    fileManager: FileManager
): Promise<{ game: Game | null; mapInfo: string }> {
    try {
        const mlt = debugStats.state.mapLoadTimings;

        const t0 = performance.now();
        const fileData = await file.readBinary();
        mlt.fileRead = Math.round(performance.now() - t0);

        const t1 = performance.now();
        const mapContent = MapLoader.getLoader(fileData);
        mlt.mapParse = Math.round(performance.now() - t1);

        if (!mapContent) {
            log.error('Unsupported map format: ' + file.name);
            return { game: null, mapInfo: '' };
        }

        const game = new Game(fileManager, mapContent);
        // Yield after heavy sync constructor — lets sprite cache prefetch microtasks resolve
        await Promise.resolve();

        return { game, mapInfo: mapContent.toString() };
    } catch (e) {
        log.error('Failed to load map: ' + file.name, e instanceof Error ? e : new Error(String(e)));
        return { game: null, mapInfo: '' };
    }
}

/** Resources available in the UI (re-exported from palette-data) */
const availableResources = ALL_RESOURCES;

/**
 * Try to restore saved game state, recording timing in mapLoadTimings.
 * If saved data is stale (version mismatch), pauses ticks and shows a warning
 * so the user can decide to discard. Returns true if stale data was detected.
 */
/**
 * Try to restore saved game state, then start auto-saving.
 * If saved data is stale (version mismatch), pauses ticks and fires onStaleDetected.
 */
function restoreAndStartPersistence(game: Game, onStaleDetected: () => void): void {
    const check = checkSavedSnapshot();

    if (check.status === 'stale') {
        log.info(`Stale save detected: version ${check.savedVersion} !== ${check.expectedVersion}`);
        game.settings.state.paused = true;
        onStaleDetected();
    } else if (check.status === 'valid') {
        const t0 = performance.now();
        log.info('Restoring saved game state...');
        restoreFromSnapshot(game, check.snapshot);
        debugStats.state.mapLoadTimings.stateRestore = Math.round(performance.now() - t0);
    }

    gameStatePersistence.start(game);
}

/** Dismiss stale snapshot warning — discards saved data and unpauses ticks. */
function dismissStaleSnapshotWarning(warning: Ref<boolean>, game: ShallowRef<Game | null>): void {
    clearSavedGameState();
    warning.value = false;
    if (game.value) {
        game.value.settings.state.paused = false;
    }
}

/** State container passed to the extracted loadMap logic. */
interface MapLoadContext {
    game: ShallowRef<Game | null>;
    fileName: Ref<string | null>;
    mapInfo: Ref<string>;
    staleSnapshotWarning: Ref<boolean>;
    mapLoadState: { isLoading: boolean; currentFile: string | null; initialized: boolean };
    getFileManager: () => FileManager;
    wireFeatureToggles: (g: Game) => void;
}

/**
 * Central map loading function. All map loads go through here.
 * Handles guards, cleanup, and state management in one place.
 */
async function loadMap(
    ctx: MapLoadContext,
    file: IFileSource | null,
    options: { isTestMap?: boolean; isEmptyMap?: boolean } = {}
): Promise<boolean> {
    const fm = ctx.getFileManager();
    const { mapLoadState } = ctx;

    // Guard: prevent concurrent loads
    if (mapLoadState.isLoading) {
        log.debug(`Skipping map load${file ? ' for ' + file.name : ''} - already loading`);
        return false;
    }

    // Guard: don't reload same file
    if (file && mapLoadState.currentFile === file.name) {
        log.debug(`Skipping map load for ${file.name} - already loaded`);
        return false;
    }

    mapLoadState.isLoading = true;
    debugStats.startMapLoad();
    console.log(`[${performance.now().toFixed(0)}ms] [perf] Map load started`);

    // Ensure game data XML is loaded before creating the Game.
    await getGameDataLoader().load();

    try {
        // Destroy old game first to prevent multiple game loops
        if (ctx.game.value) {
            gameStatePersistence.stop();
            ctx.game.value.destroy();
            ctx.game.value = null;
        }

        gameStatePersistence.resetForNewMap();
        const onStale = () => {
            ctx.staleSnapshotWarning.value = true;
        };

        if (options.isTestMap) {
            ctx.mapInfo.value = 'Test map (synthetic 256x256)';
            ctx.fileName.value = null;
            mapLoadState.currentFile = '__test_map__';
            setCurrentMapId('__test_map__');

            ctx.game.value = createTestGame(fm);
            ctx.wireFeatureToggles(ctx.game.value);
            saveInitialState(ctx.game.value);
            restoreAndStartPersistence(ctx.game.value, onStale);
            return true;
        }

        if (options.isEmptyMap) {
            ctx.mapInfo.value = 'Empty map (flat 256x256 grass)';
            ctx.fileName.value = null;
            mapLoadState.currentFile = '__empty_map__';
            setCurrentMapId('__empty_map__');

            ctx.game.value = createEmptyMapGame(fm);
            ctx.wireFeatureToggles(ctx.game.value);
            saveInitialState(ctx.game.value);
            gameStatePersistence.start(ctx.game.value);
            return true;
        }

        if (!file) {
            log.debug('No map file provided');
            return false;
        }

        const result = await loadMapFile(file, fm);
        if (!result.game) {
            log.error(`Failed to load map: ${file.name}`);
            return false;
        }

        ctx.fileName.value = file.name;
        mapLoadState.currentFile = file.name;
        ctx.mapInfo.value = result.mapInfo;
        ctx.game.value = result.game;
        ctx.wireFeatureToggles(result.game);

        setCurrentMapId(file.name);
        saveInitialState(result.game);
        restoreAndStartPersistence(result.game, onStale);

        if (isLuaEnabled()) {
            void result.game.loadScript(file.name).then(scriptResult => {
                if (scriptResult.success) log.info(`Script loaded: ${scriptResult.scriptPath}`);
            });
        }

        return true;
    } finally {
        mapLoadState.isLoading = false;
    }
}

/** Create mode toggle handler */
function createModeToggler(getGame: () => Game | null, getInputManager: () => InputManager | null) {
    return {
        setPlaceMode(buildingType: number, race: number): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

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
            if (!game || !inputManager) return;

            if (game.viewState.state.mode === 'place_pile' && game.viewState.state.placePileType === resourceType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_pile', { resourceType, amount });
            }
        },

        setPlaceUnitMode(unitType: UnitType, race: Race): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

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
function createGameActions(getGame: () => Game | null, game: ShallowRef<Game | null>) {
    return {
        removeSelected(): void {
            const g = getGame();
            if (!g || g.state.selection.selectedEntityId === null) return;
            g.execute({ type: 'remove_entity', entityId: g.state.selection.selectedEntityId });
            triggerRef(game);
        },

        togglePause(): void {
            const g = getGame();
            if (!g) return;
            if (g.isRunning) g.stop();
            else g.start();
        },

        resetGameState(): void {
            const g = getGame();
            if (!g) return;

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
function setupIconLoading(
    game: ShallowRef<Game | null>,
    getFileManager: () => FileManager,
    currentPlayerRace: Ref<Race>,
    resourceIcons: Ref<Record<number, string>>,
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
function setupLifecycle(game: ShallowRef<Game | null>, initializeMap: () => void): void {
    onMounted(() => initializeMap());
    onBeforeUnmount(() => {
        if (!game.value) return;
        gameStatePersistence.stop();
        game.value.destroy();
        game.value = null;
    });
}

export function useMapView(
    getFileManager: () => FileManager,
    getInputManager?: () => InputManager | null,
    selectedRace?: Ref<Race>
) {
    const route = useRoute();
    // Check if testMap query param is present - use computed for reactivity
    // in case the route isn't fully resolved when the composable first runs
    const isTestMap = computed(() => {
        const param = route.query['testMap'];
        return param === 'true' || param === '';
    });

    const isEmptyMap = computed(() => {
        const param = route.query['emptyMap'];
        return param === 'true' || param === '';
    });

    // =========================================================================
    // Map Loading State
    // =========================================================================

    const fileName = ref<string | null>(null);
    const mapInfo = ref('');
    const game = shallowRef<Game | null>(null);
    const staleSnapshotWarning = ref(false);
    const mapLoadState = reactive({
        isLoading: false,
        currentFile: null as string | null,
        initialized: false,
    });

    const mapLoadCtx: MapLoadContext = {
        game,
        fileName,
        mapInfo,
        staleSnapshotWarning,
        mapLoadState,
        getFileManager,
        wireFeatureToggles,
    };

    function initializeMap(): void {
        if (mapLoadState.initialized) return;
        mapLoadState.initialized = true;
        if (isTestMap.value) void loadMap(mapLoadCtx, null, { isTestMap: true });
        else if (isEmptyMap.value) void loadMap(mapLoadCtx, null, { isEmptyMap: true });
    }

    function onFileSelect(file: IFileSource): void {
        if (isTestMap.value || isEmptyMap.value) return;
        void loadMap(mapLoadCtx, file);
    }

    // =========================================================================
    // UI State
    // =========================================================================

    const showDebug = computed({
        get: () => game.value?.settings.state.showDebugGrid ?? false,
        set: (value: boolean) => {
            if (game.value) game.value.settings.state.showDebugGrid = value;
        },
    });

    const VALID_TABS = new Set(['buildings', 'units', 'resources', 'specialists']);
    const savedTab = localStorage.getItem('sidebar_active_tab');
    const activeTab = ref<'buildings' | 'units' | 'resources' | 'specialists'>(
        savedTab && VALID_TABS.has(savedTab)
            ? (savedTab as 'buildings' | 'units' | 'resources' | 'specialists')
            : 'buildings'
    );
    watch(activeTab, tab => localStorage.setItem('sidebar_active_tab', tab));
    const resourceAmount = ref(1);
    const hoveredTile = ref<TileCoord | null>(null);
    const resourceIcons = ref<Record<number, string>>({});
    const buildingIcons = ref<Record<number, IconEntry>>({});
    const unitIcons = ref<Record<string, IconEntry>>({});
    const specialistIcons = ref<Record<string, IconEntry>>({});

    // Layer visibility state (loaded from localStorage)
    const layerVisibility = reactive<LayerVisibility>(loadLayerVisibility());

    function updateLayerVisibility(newVisibility: LayerVisibility): void {
        Object.assign(layerVisibility, newVisibility);
        saveLayerVisibility(layerVisibility);
    }

    /** Wire the Territory feature toggle to sync with layer visibility's showTerritory */
    function wireFeatureToggles(g: Game): void {
        g.onTerritoryToggle(enabled => {
            layerVisibility.showTerritory = enabled;
            saveLayerVisibility(layerVisibility);
        });
    }

    // =========================================================================
    // Computed State
    // =========================================================================

    const selectedEntity = computed<Entity | undefined>(() =>
        game.value?.state.selection.selectedEntityId != null
            ? game.value.state.getEntity(game.value.state.selection.selectedEntityId)
            : undefined
    );
    const selectionCount = computed(() => game.value?.state.selection.selectedEntityIds.size ?? 0);
    const isPaused = computed(() => (game.value ? !game.value.isRunning : false));
    const currentPlayerRace = computed(
        () => selectedRace?.value ?? game.value?.playerRaces.get(game.value.currentPlayer) ?? Race.Roman
    );
    const availableBuildings = computed(() =>
        ALL_BUILDINGS.filter(b => isBuildingAvailableForRace(b.type, currentPlayerRace.value))
    );
    const availableUnits = computed(() =>
        ALL_UNITS.filter(u => isUnitAvailableForRace(u.type, currentPlayerRace.value))
    );

    // Mode state - sourced from the game's view state
    const currentMode = computed(() => game.value?.viewState.state.mode ?? 'select');
    const placeBuildingType = computed(() => game.value?.viewState.state.placeBuildingType ?? 0);
    const placeResourceType = computed(() => game.value?.viewState.state.placePileType ?? 0);
    const placeUnitType = computed(() => game.value?.viewState.state.placeUnitType ?? 0);

    const layerCounts = computed<LayerCounts>(() => {
        const vs = game.value?.viewState.state;
        if (!vs) return EMPTY_COUNTS;
        return {
            buildings: vs.buildingCount,
            units: vs.unitCount,
            piles: vs.pileCount,
            environment: vs.environmentCount,
            trees: vs.treeCount,
            stones: vs.stoneCount,
            plants: vs.plantCount,
            other: vs.otherCount,
        };
    });

    // =========================================================================
    // Lifecycle
    // =========================================================================

    setupLifecycle(game, initializeMap);

    // Re-initialize if FileManager changes (e.g., user selects new game directory)
    watch(getFileManager, () => {
        // Reset initialization flag to allow re-init with new FileManager
        mapLoadState.initialized = false;
        mapLoadState.currentFile = null;
        initializeMap();
    });

    // Update resource placement mode when amount changes
    watch(resourceAmount, () => {
        if (game.value?.viewState.state.mode === 'place_pile' && game.value.viewState.state.placePileType) {
            const inputManager = getInputManager?.();
            if (inputManager) {
                inputManager.switchMode('place_pile', {
                    resourceType: game.value.viewState.state.placePileType,
                    amount: resourceAmount.value,
                });
            }
        }
    });

    function onTileClick(tile: TileCoord) {
        hoveredTile.value = tile;
    }

    // Create mode and action handlers
    const modeToggler = createModeToggler(
        () => game.value,
        () => getInputManager?.() ?? null
    );
    const gameActions = createGameActions(() => game.value, game);

    const setPlaceMode = modeToggler.setPlaceMode;
    const setPlaceResourceMode = (rt: EMaterialType) => modeToggler.setPlacePileMode(rt, resourceAmount.value);
    const setPlaceUnitMode = (ut: UnitType) => modeToggler.setPlaceUnitMode(ut, currentPlayerRace.value);
    const setSelectMode = modeToggler.setSelectMode;
    const removeSelected = gameActions.removeSelected;
    const togglePause = gameActions.togglePause;
    const resetGameState = gameActions.resetGameState;

    const dismissStaleSnapshot = () => dismissStaleSnapshotWarning(staleSnapshotWarning, game);

    // Load icons from GFX files when game becomes available / race changes
    setupIconLoading(game, getFileManager, currentPlayerRace, resourceIcons, buildingIcons, unitIcons, specialistIcons);

    return {
        fileName,
        mapInfo,
        game,
        showDebug,
        activeTab,
        resourceAmount,
        resourceIcons,
        buildingIcons,
        unitIcons,
        specialistIcons,
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
        setPlaceMode,
        setPlaceResourceMode,
        setPlaceUnitMode,
        setSelectMode,
        removeSelected,
        togglePause,
        resetGameState,
        updateLayerVisibility,
        staleSnapshotWarning,
        dismissStaleSnapshot,
    };
}

import { ref, shallowRef, computed, watch, reactive, type Ref, type ShallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { createTestMapLoader, createEmptyMapLoader } from '@/game/test-map-factory';
import { BuildingType, TileCoord, UnitType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { EMaterialType } from '@/game/economy';
import { BinaryReader } from '@/resources/file/binary-reader';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import { saveLayerVisibility } from '@/game/renderer/layer-visibility';
import type { InputManager } from '@/game/input';
import { debugStats } from '@/game/debug/debug-stats';
import {
    gameStatePersistence,
    restoreFromSnapshot,
    clearSavedGameState,
    checkSavedSnapshot,
    setCurrentMapId,
    saveInitialState,
} from '@/game/state/game-state-persistence';
import { ALL_RESOURCES } from './palette-data';
import { getGameDataLoader } from '@/resources/game-data';
import { setupUIState, setupComputedState } from './use-map-view-state';
import { createModeToggler, createGameActions, setupIconLoading, setupLifecycle } from './use-map-view-helpers';

export type { LayerCounts } from './use-map-view-state';

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
                if (scriptResult.success) {
                    log.info(`Script loaded: ${scriptResult.scriptPath}`);
                }
            });
        }

        return true;
    } finally {
        mapLoadState.isLoading = false;
    }
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

    const mapFileParam = computed(() => route.query['mapFile'] as string | undefined);

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
        if (mapLoadState.initialized) {
            return;
        }
        mapLoadState.initialized = true;
        if (isTestMap.value) {
            void loadMap(mapLoadCtx, null, { isTestMap: true });
        } else if (isEmptyMap.value) {
            void loadMap(mapLoadCtx, null, { isEmptyMap: true });
        } else if (mapFileParam.value) {
            const mapPath = mapFileParam.value;
            const file: IFileSource = {
                name: mapPath,
                path: mapPath,
                readBinary: async () => {
                    const resp = await fetch(`/Siedler4/Map/${mapPath}`);
                    if (!resp.ok) {
                        throw new Error(`Failed to fetch map: ${resp.status} ${resp.statusText}`);
                    }
                    const buf = await resp.arrayBuffer();
                    return new BinaryReader(buf, 0, null, mapPath);
                },
            };
            void loadMap(mapLoadCtx, file);
        }
    }

    function onFileSelect(file: IFileSource): void {
        if (isTestMap.value || isEmptyMap.value) {
            return;
        }
        void loadMap(mapLoadCtx, file);
    }

    // =========================================================================
    // UI State + Computed State (extracted to use-map-view-state.ts)
    // =========================================================================

    const uiState = setupUIState();
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
    } = uiState;

    /** Wire the Territory feature toggle to sync with layer visibility's showTerritory */
    function wireFeatureToggles(g: Game): void {
        g.onTerritoryToggle(enabled => {
            layerVisibility.showTerritory = enabled;
            saveLayerVisibility(layerVisibility);
        });
    }

    const computedState = setupComputedState(game, selectedRace);
    const {
        showDebug,
        selectedEntity,
        selectionCount,
        isPaused,
        currentPlayerRace,
        availableBuildings,
        availableUnits,
        currentMode,
        placeBuildingType,
        placeResourceType,
        placeUnitType,
        layerCounts,
    } = computedState;

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

    const setPlaceMode = (buildingType: BuildingType, race: number) => modeToggler.setPlaceMode(buildingType, race);
    const setPlaceResourceMode = (rt: EMaterialType) => modeToggler.setPlacePileMode(rt, resourceAmount.value);
    const setPlaceUnitMode = (ut: UnitType) => modeToggler.setPlaceUnitMode(ut, currentPlayerRace.value);
    const setSelectMode = () => modeToggler.setSelectMode();
    const removeSelected = () => gameActions.removeSelected();
    const togglePause = () => gameActions.togglePause();
    const resetGameState = () => gameActions.resetGameState();

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

/** Renderer composable with integrated InputManager — orchestrates setup, input, and game sync. */

import { watch, onMounted, onUnmounted, ref, type Ref } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { type TileCoord, BuildingType, EntityType } from '@/game/entity';
import { Race, saveSavedRace } from '@/game/renderer/sprite-metadata';
import { canPlaceResource, canPlaceUnit, canPlaceBuildingFootprint } from '@/game/systems/placement';
import { isNonBlockingMapObject } from '@/game/data/game-data-access';
import { ValidPositionGrid, type GridComputeRequest } from '@/game/systems/placement/valid-position-grid';
import type { Command, CommandResult } from '@/game/commands';
import { debugStats } from '@/game/debug/debug-stats';
import {
    InputManager,
    SelectMode,
    PlaceBuildingMode,
    PlaceResourceMode,
    PlaceUnitMode,
    getDefaultInputConfig,
} from '@/game/input';
import type { SelectionBox } from '@/game/input/render-state';
import type { DebugEntityLabel } from '@/game/renderer/render-passes/types';
import { LayerVisibility } from '@/game/renderer/layer-visibility';
import { loadCameraState, saveCameraState } from '@/game/renderer/camera-persistence';
import { getCurrentMapId } from '@/game/state/game-state-persistence';
import { initRenderersAsync, exposeForE2E, loadOverlaySpritesAndUpdateFrameCounts } from './renderer-init';
import { createUpdateCallback, createRenderCallback } from './frame-callbacks';
import { updateTileDebugStats, createBuildingAdjustMode, handleModeChange, createHintState } from './input-setup';
import { createEntityPicker, createEntityRectPicker, type EntityPickerContext } from '@/game/input/entity-picker';

/** Build the EntityPickerContext from current game/renderer state. */
function buildPickerContext(
    getGame: () => Game | null,
    renderer: Renderer | null,
    entityRenderer: EntityRenderer | null,
    canvas: Ref<HTMLCanvasElement | null>
): EntityPickerContext | null {
    const game = getGame();
    if (!game || !renderer) {
        return null;
    }
    const el = canvas.value;
    if (!el) {
        return null;
    }
    return {
        mapSize: game.terrain.mapSize,
        groundHeight: game.terrain.groundHeight,
        viewPoint: renderer.viewPoint,
        unitStates: game.state.unitStates,
        canvasWidth: el.clientWidth,
        canvasHeight: el.clientHeight,
        zoom: renderer.viewPoint.zoom,
    };
}

function createReplaceableCheck(game: Game): (entityId: number) => boolean {
    return (id: number) => {
        const e = game.state.getEntity(id);
        return e?.type === EntityType.MapObject && isNonBlockingMapObject(e.subType as number);
    };
}

/** Check whether a building can be placed at (x, y), including the 1-tile footprint gap rule. */
function canPlaceBuilding(getGame: () => Game | null, x: number, y: number, buildingType: BuildingType): boolean {
    const game = getGame();
    if (!game) {
        return false;
    }
    const race = game.playerRaces.get(game.currentPlayer);
    if (race === undefined) {
        return false;
    }
    return canPlaceBuildingFootprint(
        game.terrain,
        game.state.groundOccupancy,
        x,
        y,
        buildingType,
        race,
        game.state.buildingFootprint,
        undefined,
        undefined,
        createReplaceableCheck(game)
    );
}

/** Create a ValidPositionGrid for the given building type when entering placement mode. */
function createPlacementGrid(
    game: Game,
    buildingType: BuildingType,
    viewX: number,
    viewY: number
): ValidPositionGrid | null {
    const race = game.playerRaces.get(game.currentPlayer);
    if (race === undefined) {
        return null;
    }
    const request: GridComputeRequest = {
        buildingType,
        race,
        player: game.currentPlayer,
        centerX: Math.round(viewX),
        centerY: Math.round(viewY),
        placementFilter: game.placementFilter,
    };
    return new ValidPositionGrid(
        request,
        game.terrain.mapSize,
        game.terrain.groundType,
        game.terrain.groundHeight,
        game.state.groundOccupancy,
        game.state.buildingFootprint,
        createReplaceableCheck(game)
    );
}

interface InputManagerDeps {
    canvas: Ref<HTMLElement | null>;
    getGame: () => Game | null;
    resolveTile: (screenX: number, screenY: number) => TileCoord | null;
    executeCommand: (cmd: Record<string, unknown>) => CommandResult;
    entityPicker: ReturnType<typeof createEntityPicker>;
    entityRectPicker: ReturnType<typeof createEntityRectPicker>;
    hintProvider: (msg: string, sx: number, sy: number) => void;
    onTileClick: (tile: { x: number; y: number }) => void;
    getRenderer: () => Renderer | null;
    onPlacementGridChange: (grid: ValidPositionGrid | null) => void;
}

/** Create and configure an InputManager with all game modes registered. */
function buildInputManager(deps: InputManagerDeps): InputManager {
    const { getGame, onTileClick, getRenderer, onPlacementGridChange } = deps;

    const placeBuildingMode = new PlaceBuildingMode(
        (x, y, buildingType) => canPlaceBuilding(getGame, x, y, buildingType),
        () => {
            const game = getGame();
            return {
                // eslint-disable-next-line no-restricted-syntax -- game is nullable before load; false is correct default
                placeBuildingsCompleted: game?.settings.state.placeBuildingsCompleted ?? false,
                // eslint-disable-next-line no-restricted-syntax -- game is nullable before load; false is correct default
                placeBuildingsWithWorker: game?.settings.state.placeBuildingsWithWorker ?? false,
            };
        }
    );

    const baseModeChange = handleModeChange(getGame);
    const manager = new InputManager({
        target: deps.canvas,
        config: getDefaultInputConfig(),
        tileResolver: deps.resolveTile,
        commandExecutor: deps.executeCommand,
        entityPicker: deps.entityPicker,
        entityRectPicker: deps.entityRectPicker,
        hintProvider: deps.hintProvider,
        initialMode: 'select',
        onModeChange: (oldMode, newMode, data) => {
            baseModeChange(oldMode, newMode, data);
            if (newMode === 'place_building') {
                const game = getGame();
                const buildingType =
                    (data?.['buildingType'] as BuildingType | undefined) ??
                    (data?.['subType'] as BuildingType | undefined);
                if (game && buildingType !== undefined) {
                    const grid = createPlacementGrid(
                        game,
                        buildingType,
                        getRenderer()!.viewPoint.x,
                        getRenderer()!.viewPoint.y
                    );
                    onPlacementGridChange(grid);
                    placeBuildingMode.setGrid(grid);
                }
            }
            if (oldMode === 'place_building' && newMode !== 'place_building') {
                onPlacementGridChange(null);
                placeBuildingMode.setGrid(null);
            }
        },
        raceProvider: () => {
            const g = getGame();
            // eslint-disable-next-line no-restricted-syntax -- Map.get() returns undefined for missing keys
            return g?.playerRaces.get(g.currentPlayer) ?? null;
        },
    });

    const tileHover = (x: number, y: number) => updateTileDebugStats(x, y, getGame, onTileClick);
    manager.registerMode(new SelectMode());
    manager.registerMode(placeBuildingMode);
    manager.registerMode(
        new PlaceResourceMode((x, y) => {
            const game = getGame();
            return game ? canPlaceResource(game.terrain, game.state.groundOccupancy, x, y) : false;
        }, tileHover)
    );
    manager.registerMode(
        new PlaceUnitMode((x, y) => {
            const game = getGame();
            return game
                ? canPlaceUnit(game.terrain, game.state.groundOccupancy, game.state.unitOccupancy, x, y)
                : false;
        }, tileHover)
    );
    manager.registerMode(createBuildingAdjustMode(getGame));
    manager.attach();
    const r = getRenderer();
    if (r) {
        manager.getCamera().setViewPoint(r.viewPoint);
    }
    return manager;
}

/** Execute a game command, updating debug stats for tile-targeting commands. */
function executeGameCommand(
    command: Record<string, unknown>,
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): CommandResult {
    const game = getGame();
    if (!game) {
        return { success: false, error: 'Game not initialized' };
    }

    if (command['type'] === 'select_at_tile' || command['type'] === 'move_selected_units') {
        const x = (command['x'] ?? command['targetX']) as number | undefined;
        const y = (command['y'] ?? command['targetY']) as number | undefined;
        if (x !== undefined && y !== undefined) {
            onTileClick({ x, y });
            debugStats.state.hasTile = true;
            debugStats.state.tileX = x;
            debugStats.state.tileY = y;
            const idx = game.terrain.toIndex(x, y);
            debugStats.state.tileGroundType = game.terrain.groundType[idx]!;
            debugStats.state.tileGroundHeight = game.terrain.groundHeight[idx]!;
        }
    }

    return game.execute(command as unknown as Command);
}

interface UseRendererOptions {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getLayerVisibility: () => LayerVisibility;
    onTileClick: (tile: { x: number; y: number }) => void;
    getInitialCamera?: () => { x: number; y: number; zoom: number } | null;
}

/** Mutable state shared between useRenderer and its extracted helpers. */
interface RendererMutableState {
    renderer: Renderer | null;
    tilePicker: TilePicker | null;
    entityRenderer: EntityRenderer | null;
    indicatorRenderer: BuildingIndicatorRenderer | null;
    landscapeRenderer: LandscapeRenderer | null;
    inputManager: InputManager | null;
    rendererInitStart: number;
    placementGrid: ValidPositionGrid | null;
}

/**
 * Create and configure renderers for the current game.
 * Populates landscapeRenderer, indicatorRenderer, and entityRenderer on the state object.
 */
function setupRenderers(state: RendererMutableState, game: Game, getDebugGrid: () => boolean): void {
    if (!state.renderer) {
        return;
    }

    state.landscapeRenderer = new LandscapeRenderer(
        game.fileManager,
        game.terrain.mapSize,
        game.terrain.groundType,
        game.terrain.groundHeight,
        getDebugGrid(),
        game.useProceduralTextures,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        game.mapLoader.landscape.getTerrainAttributes?.() ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        game.mapLoader.landscape.getGameplayAttributes?.() ?? null
    );
    state.renderer.add(state.landscapeRenderer);

    state.indicatorRenderer = new BuildingIndicatorRenderer(game.terrain.mapSize, game.terrain.groundHeight);
    state.renderer.add(state.indicatorRenderer);

    state.entityRenderer = new EntityRenderer(game.terrain.mapSize, game.terrain.groundHeight, game.fileManager);
    state.entityRenderer.registerPassDefinitions(game.services.getFeatureRenderPassDefinitions());
    state.entityRenderer.skipSpriteLoading = game.useProceduralTextures;
    state.entityRenderer.onSpritesLoaded = () => {
        debugStats.state.mapLoadTimings.rendererInit = Math.round(performance.now() - state.rendererInitStart);
        debugStats.markRendererReady();
        game.enableTicks();
        void loadOverlaySpritesAndUpdateFrameCounts(state.entityRenderer!, game);
    };
    state.renderer.add(state.entityRenderer);
}

interface InitGLDeps {
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getLayerVisibility: () => LayerVisibility;
    selectionBox: Ref<SelectionBox | null>;
}

/**
 * Initialize GL resources and bind event handlers.
 * Wires up terrain-modified listener, update/render callbacks, and e2e debug bridge.
 */
function initGLAndBindEvents(state: RendererMutableState, game: Game, deps: InitGLDeps): void {
    if (!state.renderer || !state.landscapeRenderer || !state.indicatorRenderer || !state.entityRenderer) {
        return;
    }

    const { renderer, landscapeRenderer, indicatorRenderer, entityRenderer, inputManager } = state;

    const gl = renderer.gl;
    if (gl) {
        state.rendererInitStart = performance.now();
        // eslint-disable-next-line no-restricted-syntax -- Map.get() returns undefined for missing keys
        const localPlayerRace = game.playerRaces.get(game.currentPlayer) ?? null;
        // Persist race for eager prefetch on next page load
        if (localPlayerRace !== null) {
            saveSavedRace(localPlayerRace);
        }
        void initRenderersAsync(gl, landscapeRenderer, indicatorRenderer, entityRenderer, localPlayerRace, game);
    } else {
        debugStats.state.gameLoaded = true;
        if (game.useProceduralTextures) {
            game.enableTicks();
        }
    }

    exposeForE2E(renderer.viewPoint, landscapeRenderer, entityRenderer, inputManager);

    // After state restore (HMR / autosave), overlay instances are recreated with frameCount=1.
    // Re-apply frame counts from the sprite registry so animations aren't frozen.
    game.eventBus.on('game:stateRestored', () => {
        if (state.entityRenderer) {
            void loadOverlaySpritesAndUpdateFrameCounts(state.entityRenderer, game);
        }
    });

    game.eventBus.on('terrain:modified', () => {
        state.landscapeRenderer?.markTerrainDirty();
    });

    const contextGetter = () => ({
        game: deps.getGame(),
        entityRenderer: state.entityRenderer,
        indicatorRenderer: state.indicatorRenderer,
        landscapeRenderer: state.landscapeRenderer,
        inputManager: state.inputManager,
        debugGrid: deps.getDebugGrid(),
        // eslint-disable-next-line no-restricted-syntax -- optional flag with sensible boolean default
        darkLandDilation: deps.getGame()?.settings.state.darkLandDilation ?? true,
        layerVisibility: deps.getLayerVisibility(),
        placementGrid: state.placementGrid,
    });

    // Register update callback (input, sound, debug stats — runs before render)
    game.setUpdateCallback(createUpdateCallback(contextGetter, renderer, deps.selectionBox));

    // Register render callback (visual sync + GPU draw only)
    game.setRenderCallback(createRenderCallback(contextGetter, renderer));
}

export function useRenderer({
    canvas,
    getGame,
    getDebugGrid,
    getLayerVisibility,
    onTileClick,
    getInitialCamera,
}: UseRendererOptions) {
    const state: RendererMutableState = {
        renderer: null,
        tilePicker: null,
        entityRenderer: null,
        indicatorRenderer: null,
        landscapeRenderer: null,
        inputManager: null,
        rendererInitStart: 0,
        placementGrid: null,
    };

    const selectionBox = ref<SelectionBox | null>(null); // drag selection overlay
    const { hintMessage, hintProvider } = createHintState(); // transient cursor hint

    /**
     * Resolve screen coordinates to tile coordinates.
     */
    function resolveTile(screenX: number, screenY: number): TileCoord | null {
        const game = getGame();
        if (!game || !state.tilePicker || !state.renderer) {
            return null;
        }
        return state.tilePicker.screenToTile(
            screenX,
            screenY,
            state.renderer.viewPoint,
            game.terrain.mapSize,
            game.terrain.groundHeight
        );
    }

    const executeCommand = (command: Record<string, unknown>): CommandResult =>
        executeGameCommand(command, getGame, onTileClick);

    const entityPicker = createEntityPicker(
        // eslint-disable-next-line no-restricted-syntax -- game is nullable before load; [] is correct empty entity list when absent
        () => getGame()?.state.entities ?? [],
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        () => state.entityRenderer?.spriteResolver ?? null,
        () => getGame()!.state.selection,
        () => buildPickerContext(getGame, state.renderer, state.entityRenderer, canvas)
    );

    const entityRectPicker = createEntityRectPicker(
        // eslint-disable-next-line no-restricted-syntax -- game is nullable before load; [] is correct empty entity list when absent
        () => getGame()?.state.entities ?? [],
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        () => state.entityRenderer?.spriteResolver ?? null,
        () => getGame()!.state.selection,
        () => buildPickerContext(getGame, state.renderer, state.entityRenderer, canvas)
    );

    /** Create and configure the InputManager with all modes registered. */
    function createInputManager(): void {
        if (!canvas.value) {
            return;
        }
        state.inputManager = buildInputManager({
            canvas: canvas as Ref<HTMLElement | null>,
            getGame,
            resolveTile,
            executeCommand,
            entityPicker,
            entityRectPicker,
            hintProvider,
            onTileClick,
            getRenderer: () => state.renderer,
            onPlacementGridChange: grid => {
                state.placementGrid = grid;
            },
        });
    }

    /**
     * Initialize the renderer for a new game.
     * Sets up renderers, positions camera, and starts the game.
     */
    function initRenderer(): void {
        const game = getGame();
        if (game == null || state.renderer == null) {
            return;
        }

        debugStats.reset();
        game.viewState.reset();
        state.renderer.clear();

        // Inject game settings into ViewPoint and InputManager
        state.renderer.viewPoint.setSettings(game.settings.state);
        if (state.inputManager) {
            state.inputManager.setSettings(game.settings.state);
        }

        setupRenderers(state, game, getDebugGrid);
        initGLAndBindEvents(state, game, { getGame, getDebugGrid, getLayerVisibility, selectionBox });

        // Restore camera: prefer explicit prop (settings recreation), then per-map localStorage (HMR),
        // then center on player start (fresh map load / reset)
        const camera = getInitialCamera?.() ?? loadCameraState(getCurrentMapId());
        if (camera) {
            state.renderer.viewPoint.setRawPosition(camera.x, camera.y);
            state.renderer.viewPoint.zoomValue = camera.zoom;
        } else {
            centerOnPlayerStart();
        }

        game.start();
    }

    /** Save camera position to localStorage so it survives HMR and page reloads. */
    function persistCamera(): void {
        const mapId = getCurrentMapId();
        if (!mapId || !state.renderer) {
            return;
        }
        saveCameraState(mapId, {
            x: state.renderer.viewPoint.x,
            y: state.renderer.viewPoint.y,
            zoom: state.renderer.viewPoint.zoomValue,
        });
    }

    onMounted(() => {
        console.log(`[${performance.now().toFixed(0)}ms] [perf] Canvas mounted`);
        const cavEl = canvas.value!;
        const game = getGame();
        state.renderer = new Renderer(cavEl, { externalInput: true, antialias: game?.settings.state.antialias });
        state.tilePicker = new TilePicker(cavEl);

        window.addEventListener('beforeunload', persistCamera);

        createInputManager();
        initRenderer();
    });

    watch(getGame, () => {
        initRenderer();
    });

    onUnmounted(() => {
        window.removeEventListener('beforeunload', persistCamera);
        persistCamera();

        // Do NOT destroy the game here — use-renderer does not own it.
        // The game is created and destroyed by use-map-view (setupLifecycle).
        state.inputManager?.destroy();
        state.inputManager = null;

        if (state.renderer) {
            state.renderer.destroy();
        }
    });

    async function setRace(race: Race): Promise<boolean> {
        if (!state.entityRenderer) {
            return false;
        }
        return state.entityRenderer.setRace(race);
    }

    function getRace(): Race {
        if (!state.entityRenderer) {
            throw new Error('getRace called before entityRenderer is initialized');
        }
        return state.entityRenderer.getRace();
    }

    const getInputManager = (): InputManager | null => state.inputManager;

    function getCamera(): { x: number; y: number; zoom: number } | null {
        if (!state.renderer) {
            return null;
        }
        return {
            x: state.renderer.viewPoint.x,
            y: state.renderer.viewPoint.y,
            zoom: state.renderer.viewPoint.zoomValue,
        };
    }

    /** Center camera on the current player's start position (Castle), or first land tile, with standard zoom. */
    function centerOnPlayerStart(): void {
        if (!state.renderer) {
            return;
        }
        const game = getGame();
        if (!game) {
            return;
        }
        const pos = game.findPlayerStartPosition();
        if (pos) {
            state.renderer.viewPoint.setPosition(pos.x, pos.y);
            state.renderer.viewPoint.zoomValue = 2;
        }
    }

    // eslint-disable-next-line no-restricted-syntax -- entityRenderer is nullable before init; [] is correct empty label list when absent
    const getDecoLabels = (): DebugEntityLabel[] => state.entityRenderer?.debugDecoLabels ?? [];

    return {
        getRenderer: () => state.renderer,
        setRace,
        getRace,
        getInputManager,
        getCamera,
        centerOnPlayerStart,
        getDecoLabels,
        selectionBox,
        hintMessage,
    };
}

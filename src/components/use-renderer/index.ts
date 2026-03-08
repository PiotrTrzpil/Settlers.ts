/**
 * use-renderer — Renderer composable with integrated InputManager.
 *
 * Orchestrates renderer setup, input handling, and game state synchronization.
 * Implementation details are split across sibling modules.
 */

import { watch, onMounted, onUnmounted, ref, type Ref } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { type TileCoord, BuildingType } from '@/game/entity';
import { Race, AVAILABLE_RACES, saveSavedRace } from '@/game/renderer/sprite-metadata';
import { canPlaceResource, canPlaceUnit, canPlaceBuildingFootprint } from '@/game/features/placement';
import { ValidPositionGrid, type GridComputeRequest } from '@/game/features/placement/valid-position-grid';
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
import { loadCameraState } from '@/game/renderer/camera-persistence';
import { getCurrentMapId } from '@/game/state/game-state-persistence';
import { initRenderersAsync, exposeForE2E } from './renderer-init';
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
    if (!game || !renderer) return null;
    const el = canvas.value;
    if (!el) return null;
    return {
        mapSize: game.terrain.mapSize,
        groundHeight: game.terrain.groundHeight,
        viewPoint: renderer.viewPoint,
        unitStates: entityRenderer?.unitStates ?? { get: () => undefined },
        canvasWidth: el.clientWidth,
        canvasHeight: el.clientHeight,
        zoom: renderer.viewPoint.zoom,
    };
}

/**
 * After building sprites finish loading, load overlay sprites for all races
 * and update the BuildingOverlayManager with the resolved frame counts.
 */
async function loadOverlaySpritesAndUpdateFrameCounts(er: EntityRenderer, game: Game): Promise<void> {
    const spriteManager = er.spriteManager;
    if (!spriteManager) return;

    // Collect sprite refs for all races (overlays live in each race's GFX file)
    const manifest: { gfxFile: number; jobIndex: number; directionIndex?: number }[] = [];
    for (const race of AVAILABLE_RACES) {
        for (const def of game.services.overlayRegistry.getSpriteManifest(race)) {
            manifest.push(def.spriteRef);
        }
    }
    if (manifest.length === 0) return;

    // Check if overlays are already in the registry (cache hit with full overlay data).
    // Use .some() across the whole manifest — the first entry may fail to load (missing GFX job),
    // so checking only manifest[0] would trigger a reload every time.
    const alreadyLoaded = manifest.some(
        e => spriteManager.getOverlayFrames(e.gfxFile, e.jobIndex, e.directionIndex ?? 0) !== null
    );

    if (!alreadyLoaded) {
        const tOverlay = performance.now();
        await spriteManager.loadOverlaySprites(manifest);
        debugStats.state.loadTimings.overlaySprites = Math.round(performance.now() - tOverlay);
        // Save cache now that overlays are included — subsequent hits skip overlay loading entirely.
        spriteManager.saveCache();
    }

    // Always update frame counts (cheap read from registry, no loading).
    for (const race of AVAILABLE_RACES) {
        for (const def of game.services.overlayRegistry.getSpriteManifest(race)) {
            const { gfxFile, jobIndex, directionIndex = 0 } = def.spriteRef;
            const frames = spriteManager.getOverlayFrames(gfxFile, jobIndex, directionIndex);
            if (frames && frames.length > 0) {
                game.services.buildingOverlayManager.setFrameCountForDef(
                    gfxFile,
                    jobIndex,
                    directionIndex,
                    frames.length
                );
            }
        }
    }
}

/** Check whether a building can be placed at (x, y), including the 1-tile footprint gap rule. */
function canPlaceBuilding(getGame: () => Game | null, x: number, y: number, buildingType: BuildingType): boolean {
    const game = getGame();
    if (!game) return false;
    const race = game.playerRaces.get(game.currentPlayer);
    if (race === undefined) return false;
    return canPlaceBuildingFootprint(
        game.terrain,
        game.state.tileOccupancy,
        x,
        y,
        buildingType,
        race,
        game.state.buildingFootprint
    );
}

/** Create a ValidPositionGrid for the given building type when entering placement mode. */
function createPlacementGrid(game: Game, buildingType: number, viewX: number, viewY: number): ValidPositionGrid | null {
    const race = game.playerRaces.get(game.currentPlayer);
    if (race === undefined) return null;
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
        game.state.tileOccupancy,
        game.state.buildingFootprint
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
                placeBuildingsCompleted: game?.settings.state.placeBuildingsCompleted ?? false,
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
                    (data?.['buildingType'] as number | undefined) ?? (data?.['subType'] as number | undefined);
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
            if (oldMode === 'place_building') {
                onPlacementGridChange(null);
                placeBuildingMode.setGrid(null);
            }
        },
        raceProvider: () => {
            const g = getGame();
            return g?.playerRaces.get(g.currentPlayer) ?? null;
        },
    });

    const tileHover = (x: number, y: number) => updateTileDebugStats(x, y, getGame, onTileClick);
    manager.registerMode(new SelectMode());
    manager.registerMode(placeBuildingMode);
    manager.registerMode(
        new PlaceResourceMode((x, y) => {
            const game = getGame();
            return game ? canPlaceResource(game.terrain, game.state.tileOccupancy, x, y) : false;
        }, tileHover)
    );
    manager.registerMode(
        new PlaceUnitMode((x, y) => {
            const game = getGame();
            return game ? canPlaceUnit(game.terrain, game.state.tileOccupancy, x, y) : false;
        }, tileHover)
    );
    manager.registerMode(createBuildingAdjustMode(getGame));
    manager.attach();
    const r = getRenderer();
    if (r) manager.getCamera().setViewPoint(r.viewPoint);
    return manager;
}

/** Execute a game command, updating debug stats for tile-targeting commands. */
function executeGameCommand(
    command: Record<string, unknown>,
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): CommandResult {
    const game = getGame();
    if (!game) return { success: false, error: 'Game not initialized' };

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

export function useRenderer({
    canvas,
    getGame,
    getDebugGrid,
    getLayerVisibility,
    onTileClick,
    getInitialCamera,
}: UseRendererOptions) {
    let renderer: Renderer | null = null;
    let tilePicker: TilePicker | null = null;
    let entityRenderer: EntityRenderer | null = null;
    let indicatorRenderer: BuildingIndicatorRenderer | null = null;
    let landscapeRenderer: LandscapeRenderer | null = null;
    let inputManager: InputManager | null = null;
    let rendererInitStart = 0;
    let placementGrid: ValidPositionGrid | null = null;

    const selectionBox = ref<SelectionBox | null>(null); // drag selection overlay
    const { hintMessage, hintProvider } = createHintState(); // transient cursor hint

    /**
     * Resolve screen coordinates to tile coordinates.
     */
    function resolveTile(screenX: number, screenY: number): TileCoord | null {
        const game = getGame();
        if (!game || !tilePicker || !renderer) return null;
        return tilePicker.screenToTile(
            screenX,
            screenY,
            renderer.viewPoint,
            game.terrain.mapSize,
            game.terrain.groundHeight
        );
    }

    const executeCommand = (command: Record<string, unknown>): CommandResult =>
        executeGameCommand(command, getGame, onTileClick);

    const entityPicker = createEntityPicker(
        () => entityRenderer?.entities ?? [],
        () => entityRenderer?.spriteResolver ?? null,
        () => getGame()!.state.selection,
        () => buildPickerContext(getGame, renderer, entityRenderer, canvas)
    );

    const entityRectPicker = createEntityRectPicker(
        () => entityRenderer?.entities ?? [],
        () => entityRenderer?.spriteResolver ?? null,
        () => getGame()!.state.selection,
        () => buildPickerContext(getGame, renderer, entityRenderer, canvas)
    );

    /** Create and configure the InputManager with all modes registered. */
    function createInputManager(): void {
        if (!canvas.value) return;
        inputManager = buildInputManager({
            canvas: canvas as Ref<HTMLElement | null>,
            getGame,
            resolveTile,
            executeCommand,
            entityPicker,
            entityRectPicker,
            hintProvider,
            onTileClick,
            getRenderer: () => renderer,
            onPlacementGridChange: grid => {
                placementGrid = grid;
            },
        });
    }

    /**
     * Create and configure renderers for the current game.
     */
    function setupRenderers(game: Game): void {
        if (!renderer) return;

        landscapeRenderer = new LandscapeRenderer(
            game.fileManager,
            game.terrain.mapSize,
            game.terrain.groundType,
            game.terrain.groundHeight,
            getDebugGrid(),
            game.useProceduralTextures,
            game.mapLoader.landscape.getTerrainAttributes?.() ?? null,
            game.mapLoader.landscape.getGameplayAttributes?.() ?? null
        );
        renderer.add(landscapeRenderer);

        indicatorRenderer = new BuildingIndicatorRenderer(game.terrain.mapSize, game.terrain.groundHeight);
        renderer.add(indicatorRenderer);

        entityRenderer = new EntityRenderer(game.terrain.mapSize, game.terrain.groundHeight, game.fileManager);
        entityRenderer.skipSpriteLoading = game.useProceduralTextures;
        entityRenderer.onSpritesLoaded = () => {
            debugStats.state.mapLoadTimings.rendererInit = Math.round(performance.now() - rendererInitStart);
            debugStats.markRendererReady();
            game.enableTicks();
            void loadOverlaySpritesAndUpdateFrameCounts(entityRenderer!, game);
        };
        renderer.add(entityRenderer);
    }

    /**
     * Initialize GL resources and bind event handlers.
     */
    function initGLAndBindEvents(game: Game): void {
        if (!renderer || !landscapeRenderer || !indicatorRenderer || !entityRenderer) return;

        const gl = renderer.gl;
        if (gl) {
            rendererInitStart = performance.now();
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

        game.eventBus.on('terrain:modified', () => {
            landscapeRenderer?.markTerrainDirty();
        });

        const contextGetter = () => ({
            game: getGame(),
            entityRenderer,
            indicatorRenderer,
            landscapeRenderer,
            inputManager,
            debugGrid: getDebugGrid(),
            darkLandDilation: getGame()?.settings.state.darkLandDilation ?? true,
            layerVisibility: getLayerVisibility(),
            placementGrid,
        });

        // Register update callback (input, sound, debug stats — runs before render)
        game.setUpdateCallback(createUpdateCallback(contextGetter, renderer, selectionBox));

        // Register render callback (visual sync + GPU draw only)
        game.setRenderCallback(createRenderCallback(contextGetter, renderer));
    }

    /**
     * Initialize the renderer for a new game.
     * Sets up renderers, positions camera, and starts the game.
     */
    function initRenderer(): void {
        const game = getGame();
        if (game == null || renderer == null) return;

        debugStats.reset();
        game.viewState.reset();
        renderer.clear();

        // Inject game settings into ViewPoint and InputManager
        renderer.viewPoint.setSettings(game.settings.state);
        if (inputManager) inputManager.setSettings(game.settings.state);

        setupRenderers(game);
        initGLAndBindEvents(game);

        // Restore camera: prefer explicit prop (settings recreation), then per-map localStorage (HMR),
        // then center on player start (fresh map load / reset)
        const camera = getInitialCamera?.() ?? loadCameraState(getCurrentMapId());
        if (camera) {
            renderer.viewPoint.setRawPosition(camera.x, camera.y);
            renderer.viewPoint.zoomValue = camera.zoom;
        } else {
            centerOnPlayerStart();
        }

        game.start();
    }

    onMounted(() => {
        console.log(`[${performance.now().toFixed(0)}ms] [perf] Canvas mounted`);
        const cavEl = canvas.value!;
        const game = getGame();
        renderer = new Renderer(cavEl, { externalInput: true, antialias: game?.settings.state.antialias });
        tilePicker = new TilePicker(cavEl);

        createInputManager();
        initRenderer();
    });

    watch(getGame, () => {
        initRenderer();
    });

    onUnmounted(() => {
        const game = getGame();
        if (game) game.destroy();

        inputManager?.destroy();
        inputManager = null;

        if (renderer) {
            renderer.destroy();
        }
    });

    async function setRace(race: Race): Promise<boolean> {
        if (!entityRenderer) return false;
        return entityRenderer.setRace(race);
    }

    function getRace(): Race {
        if (!entityRenderer) {
            throw new Error('getRace called before entityRenderer is initialized');
        }
        return entityRenderer.getRace();
    }

    const getInputManager = (): InputManager | null => inputManager;

    function getCamera(): { x: number; y: number; zoom: number } | null {
        if (!renderer) return null;
        return {
            x: renderer.viewPoint.x,
            y: renderer.viewPoint.y,
            zoom: renderer.viewPoint.zoomValue,
        };
    }

    /** Center camera on the current player's start position (Castle), or first land tile, with standard zoom. */
    function centerOnPlayerStart(): void {
        if (!renderer) return;
        const game = getGame();
        if (!game) return;
        const pos = game.findPlayerStartPosition();
        if (pos) {
            renderer.viewPoint.setPosition(pos.x, pos.y);
            renderer.viewPoint.zoomValue = 2;
        }
    }

    const getDecoLabels = (): DebugEntityLabel[] => entityRenderer?.debugDecoLabels ?? [];

    return {
        getRenderer: () => renderer,
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

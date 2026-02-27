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
import { type TileCoord } from '@/game/entity';
import { Race } from '@/game/renderer/sprite-metadata';
import {
    canPlaceBuildingFootprint,
    canPlaceResource,
    canPlaceUnit,
    isBuildable,
    isMineBuildable,
    computeSlopeDifficulty,
    computeHeightRange,
    MAX_SLOPE_DIFF,
} from '@/game/features/placement';
import type { Command, CommandResult } from '@/game/commands';
import { debugStats } from '@/game/debug-stats';
import {
    InputManager,
    SelectMode,
    PlaceBuildingMode,
    PlaceResourceMode,
    PlaceUnitMode,
    getDefaultInputConfig,
} from '@/game/input';
import type { SelectionBox } from '@/game/input/render-state';
import { LayerVisibility } from '@/game/renderer/layer-visibility';
import { loadCameraState } from '@/game/renderer/camera-persistence';
import { getCurrentMapId } from '@/game/game-state-persistence';
import { initRenderersAsync, cancelRendererInit, exposeForE2E } from './renderer-init';
import { createUpdateCallback, createRenderCallback } from './frame-callbacks';
import { updateTileDebugStats, createBuildingAdjustMode, handleModeChange } from './input-setup';

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

    // Selection box state for rendering drag selection overlay
    const selectionBox = ref<SelectionBox | null>(null);

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

    /**
     * Execute a game command, updating debug stats for tile clicks.
     * Returns CommandResult with success status, error details, and effects.
     */
    function executeCommand(command: Record<string, unknown>): CommandResult {
        const game = getGame();
        if (!game) return { success: false, error: 'Game not initialized' };

        // Track tile info for debug stats on tile-targeting commands
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

    /**
     * Create and configure the InputManager.
     */
    function createInputManager(): void {
        if (!canvas.value) return;

        inputManager = new InputManager({
            target: canvas as Ref<HTMLElement | null>,
            config: getDefaultInputConfig(),
            tileResolver: resolveTile,
            commandExecutor: executeCommand,
            initialMode: 'select',
            onModeChange: handleModeChange(getGame),
        });

        inputManager.registerMode(new SelectMode());
        const tileHover = (x: number, y: number) => updateTileDebugStats(x, y, getGame, onTileClick);

        inputManager.registerMode(
            new PlaceBuildingMode((x, y, buildingType) => {
                const game = getGame();
                return game
                    ? canPlaceBuildingFootprint(game.terrain, game.state.tileOccupancy, x, y, buildingType)
                    : false;
            }, tileHover)
        );
        inputManager.registerMode(
            new PlaceResourceMode((x, y) => {
                const game = getGame();
                return game ? canPlaceResource(game.terrain, game.state.tileOccupancy, x, y) : false;
            }, tileHover)
        );
        inputManager.registerMode(
            new PlaceUnitMode((x, y) => {
                const game = getGame();
                return game ? canPlaceUnit(game.terrain, game.state.tileOccupancy, x, y) : false;
            }, tileHover)
        );
        inputManager.registerMode(createBuildingAdjustMode(getGame));
        inputManager.attach();

        // Connect camera mode to the ViewPoint
        if (renderer) {
            inputManager.getCamera().setViewPoint(renderer.viewPoint);
        }
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

        indicatorRenderer = new BuildingIndicatorRenderer(
            game.terrain.mapSize,
            game.terrain.groundType,
            game.terrain.groundHeight,
            {
                isBuildableTerrain: isBuildable,
                isMineBuildableTerrain: isMineBuildable,
                computeSlopeDifficulty,
                computeHeightRange,
                maxSlopeDiff: MAX_SLOPE_DIFF,
            }
        );
        renderer.add(indicatorRenderer);

        entityRenderer = new EntityRenderer(game.terrain.mapSize, game.terrain.groundHeight, game.fileManager);
        entityRenderer.skipSpriteLoading = game.useProceduralTextures;
        entityRenderer.onSpritesLoaded = () => {
            debugStats.state.mapLoadTimings.rendererInit = Math.round(performance.now() - rendererInitStart);
            debugStats.markRendererReady();
            game.enableTicks();
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
            void initRenderersAsync(gl, landscapeRenderer, indicatorRenderer, entityRenderer);
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
        cancelRendererInit();
        renderer.clear();

        // Inject game settings into ViewPoint and InputManager
        renderer.viewPoint.setSettings(game.settings.state);
        if (inputManager) inputManager.setSettings(game.settings.state);

        setupRenderers(game);
        initGLAndBindEvents(game);

        // Restore camera: prefer explicit prop, then per-map localStorage, then player start position
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
        const cavEl = canvas.value!;
        // Pass externalInput: true to disable ViewPoint's legacy mouse handlers
        // since we use InputManager for all input handling
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
        cancelRendererInit();

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

    /**
     * Get the input manager for external control.
     */
    function getInputManager(): InputManager | null {
        return inputManager;
    }

    /**
     * Get current camera state for saving/restoring across recreations.
     */
    function getCamera(): { x: number; y: number; zoom: number } | null {
        if (!renderer) return null;
        return {
            x: renderer.viewPoint.x,
            y: renderer.viewPoint.y,
            zoom: renderer.viewPoint.zoomValue,
        };
    }

    /** Center camera on the current player's start position (Castle), or first land tile. */
    function centerOnPlayerStart(): void {
        if (!renderer) return;
        const game = getGame();
        if (!game) return;
        const pos = game.findPlayerStartPosition();
        if (pos) renderer.viewPoint.setPosition(pos.x, pos.y);
    }

    function getDecoLabels(): Array<{ screenX: number; screenY: number; type: number; hue: number }> {
        return entityRenderer?.debugDecoLabels ?? [];
    }

    return {
        getRenderer: () => renderer,
        setRace,
        getRace,
        getInputManager,
        getCamera,
        centerOnPlayerStart,
        getDecoLabels,
        selectionBox,
    };
}

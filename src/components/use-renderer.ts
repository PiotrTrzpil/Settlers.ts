/**
 * use-renderer.ts - Renderer composable with integrated InputManager
 *
 * This composable sets up the WebGL renderer and handles all input
 * through the new InputManager system.
 */

import { watch, onMounted, onUnmounted, ref, type Ref } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer, type FrameRenderTiming } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { type TileCoord } from '@/game/entity';
import { Race } from '@/game/renderer/sprite-metadata';
import { canPlaceBuildingFootprint, canPlaceResource, canPlaceUnit } from '@/game/features/placement';
import { debugStats } from '@/game/debug-stats';
import {
    InputManager,
    SelectMode,
    PlaceBuildingMode,
    PlaceResourceMode,
    PlaceUnitMode,
    type PlaceBuildingModeData,
    type PlaceResourceModeData,
    type PlaceUnitModeData,
    getDefaultInputConfig,
    type PlacementEntityType,
} from '@/game/input';
import { LayerVisibility } from '@/game/renderer/layer-visibility';
import type { SelectionBox, PlacementPreview } from '@/game/input/render-state';
import { createRenderContext } from '@/game/renderer/render-context';
import { getBuildingVisualState } from '@/game/features/building-construction';

/** Context object for render callback - avoids excessive callback parameters */
interface CallbackContext {
    game: Game | null;
    entityRenderer: EntityRenderer | null;
    landscapeRenderer: LandscapeRenderer | null;
    inputManager: InputManager | null;
    debugGrid: boolean;
    layerVisibility: LayerVisibility;
}

/** Update entity renderer state from game using RenderContext interface */
function syncEntityRendererState(
    er: EntityRenderer,
    g: Game,
    ctx: CallbackContext,
    alpha: number,
    viewPoint: import('@/game/renderer/i-view-point').IViewPoint
): void {
    // Build render context using the builder pattern
    const buildingStates = g.gameLoop.buildingStateManager.buildingStates;
    const renderContext = createRenderContext()
        .entities(g.state.entities)
        .unitStates(g.state.unitStates)
        .resourceStates(g.state.resourceStates)
        .buildingStates(buildingStates)
        .buildingVisualStateGetter(entityId => {
            const state = g.gameLoop.buildingStateManager.getBuildingState(entityId);
            return getBuildingVisualState(state);
        })
        .selection({
            primaryId: g.state.selectedEntityId,
            ids: g.state.selectedEntityIds,
        })
        .alpha(alpha)
        .layerVisibility(ctx.layerVisibility)
        .groundHeight(g.groundHeight)
        .groundType(g.groundType)
        .mapSize(g.mapSize.width, g.mapSize.height)
        .viewPoint(viewPoint)
        .build();

    // Use the new setContext method
    er.setContext(renderContext);
}

/** Handle placement mode rendering state using consolidated preview */
function updatePlacementModeState(er: EntityRenderer, renderState: any): void {
    const preview = renderState?.preview as PlacementPreview | undefined;

    // Handle new unified PlacementPreview type
    if (preview?.type === 'placement') {
        const amount = (preview.extra?.amount as number) ?? 1;
        const variation = preview.entityType === 'resource' ? Math.max(0, Math.min(amount - 1, 7)) : undefined;

        er.placementPreview = {
            tile: { x: preview.x, y: preview.y },
            valid: preview.valid,
            entityType: preview.entityType,
            subType: preview.subType,
            variation,
        };
    }
    // Handle legacy BuildingPreview/ResourcePreview types for backward compatibility
    else if (preview?.type === 'building' || preview?.type === 'resource') {
        const entityType = preview.type as PlacementEntityType;
        const subType = preview.type === 'building' ? (preview as any).buildingType : (preview as any).materialType;
        const amount = preview.type === 'resource' ? ((preview as any).amount ?? 1) : 1;
        const variation = preview.type === 'resource' ? Math.max(0, Math.min(amount - 1, 7)) : undefined;

        er.placementPreview = {
            tile: { x: preview.x, y: preview.y },
            valid: preview.valid,
            entityType,
            subType,
            variation,
        };
    } else {
        er.placementPreview = null;
    }
}

/** Clear placement mode state */
function clearPlacementModeState(er: EntityRenderer): void {
    er.placementPreview = null;
}

/**
 * Create the per-frame update callback for non-rendering work.
 * Called by GameLoop BEFORE the render callback each visible frame.
 * Handles: input processing, sound, debug stats.
 */
function createUpdateCallback(
    getContext: () => CallbackContext,
    renderer: Renderer,
    selectionBox: Ref<SelectionBox | null>
): (deltaSec: number) => void {
    return (deltaSec: number): void => {
        const ctx = getContext();
        const { game: g, entityRenderer: er, inputManager } = ctx;

        // Camera interpolation for smooth panning
        renderer.viewPoint.update(deltaSec);

        // Input processing
        if (er && g) {
            inputManager?.update(deltaSec);

            const renderState = inputManager?.getRenderState();
            selectionBox.value = renderState?.preview?.type === 'selection_box' ? renderState.preview : null;

            if (renderState?.cursor && renderer.canvas) {
                renderer.canvas.style.cursor = renderState.cursor;
            }
        }

        // Debug stats + sound
        if (g) {
            debugStats.updateFromGame(g);
            g.soundManager.updateListener(renderer.viewPoint.x, renderer.viewPoint.y);
        }

        debugStats.state.cameraX = Math.round(renderer.viewPoint.x * 10) / 10;
        debugStats.state.cameraY = Math.round(renderer.viewPoint.y * 10) / 10;
        debugStats.state.zoom = Math.round(renderer.viewPoint.zoomValue * 100) / 100;
        debugStats.state.canvasWidth = renderer.canvas.width;
        debugStats.state.canvasHeight = renderer.canvas.height;
    };
}

/**
 * Create the render callback — ONLY rendering work.
 * Syncs visual state to the entity renderer, then draws.
 */
function createRenderCallback(
    getContext: () => CallbackContext,
    renderer: Renderer
): (alpha: number, deltaSec: number) => FrameRenderTiming | null {
    return (alpha: number, _deltaSec: number): FrameRenderTiming | null => {
        const ctx = getContext();
        const { game: g, entityRenderer: er, landscapeRenderer, inputManager } = ctx;

        // Sync visual state to renderers
        if (er && g) {
            syncEntityRendererState(er, g, ctx, alpha, renderer.viewPoint);

            const renderState = inputManager?.getRenderState();
            const mode = debugStats.state.mode;
            const inPlacementMode = mode === 'place_building' || mode === 'place_resource' || mode === 'place_unit';
            er.buildingIndicatorsEnabled = inPlacementMode;

            if (inPlacementMode) {
                updatePlacementModeState(er, renderState);
            } else {
                clearPlacementModeState(er);
            }
        }

        if (landscapeRenderer) landscapeRenderer.debugGrid = ctx.debugGrid;

        // GPU draw
        renderer.drawOnce();

        return renderer.getLastRenderTiming();
    };
}

/**
 * Update debug stats with tile information during pointer move.
 * Shared by all placement modes.
 */
function updateTileDebugStats(
    tileX: number,
    tileY: number,
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): void {
    onTileClick({ x: tileX, y: tileY });
    debugStats.state.hasTile = true;
    debugStats.state.tileX = tileX;
    debugStats.state.tileY = tileY;

    const game = getGame();
    if (game) {
        const idx = game.mapSize.toIndex(tileX, tileY);
        debugStats.state.tileGroundType = game.groundType[idx];
        debugStats.state.tileGroundHeight = game.groundHeight[idx];
    }
}

/**
 * Configure the PlaceBuildingMode with validation and debug stats integration.
 */
function configurePlaceBuildingMode(
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): PlaceBuildingMode {
    const mode = new PlaceBuildingMode();
    const originalOnPointerMove = mode.onPointerMove.bind(mode);

    mode.onPointerMove = (data, context) => {
        if (data.tileX !== undefined && data.tileY !== undefined) {
            updateTileDebugStats(data.tileX, data.tileY, getGame, onTileClick);
        }

        const modeData = context.getModeData<PlaceBuildingModeData>();
        if (modeData && !modeData.validatePlacement) {
            modeData.validatePlacement = (x: number, y: number, buildingType) => {
                const game = getGame();
                if (!game) return false;

                return canPlaceBuildingFootprint(
                    game.groundType,
                    game.groundHeight,
                    game.mapSize,
                    game.state.tileOccupancy,
                    x,
                    y,
                    buildingType
                );
            };
            context.setModeData(modeData);
        }

        return originalOnPointerMove(data, context);
    };

    return mode;
}

/**
 * Configure PlaceResourceMode with validation and debug stats integration.
 * Uses centralized canPlaceResource validation.
 */
function configurePlaceResourceMode(
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): PlaceResourceMode {
    const mode = new PlaceResourceMode();
    const originalOnPointerMove = mode.onPointerMove.bind(mode);

    mode.onPointerMove = (data, context) => {
        if (data.tileX !== undefined && data.tileY !== undefined) {
            updateTileDebugStats(data.tileX, data.tileY, getGame, onTileClick);
        }

        const modeData = context.getModeData<PlaceResourceModeData>();
        if (modeData && !modeData.validatePlacement) {
            modeData.validatePlacement = (x: number, y: number) => {
                const game = getGame();
                if (!game) return false;

                return canPlaceResource(game.groundType, game.mapSize, game.state.tileOccupancy, x, y);
            };
            context.setModeData(modeData);
        }

        return originalOnPointerMove(data, context);
    };

    return mode;
}

/**
 * Configure PlaceUnitMode with validation and debug stats integration.
 * Uses centralized canPlaceUnit validation.
 */
function configurePlaceUnitMode(
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): PlaceUnitMode {
    const mode = new PlaceUnitMode();
    const originalOnPointerMove = mode.onPointerMove.bind(mode);

    mode.onPointerMove = (data, context) => {
        if (data.tileX !== undefined && data.tileY !== undefined) {
            updateTileDebugStats(data.tileX, data.tileY, getGame, onTileClick);
        }

        const modeData = context.getModeData<PlaceUnitModeData>();
        if (modeData && !modeData.validatePlacement) {
            modeData.validatePlacement = (x: number, y: number) => {
                const game = getGame();
                if (!game) return false;

                return canPlaceUnit(game.groundType, game.mapSize, game.state.tileOccupancy, x, y);
            };
            context.setModeData(modeData);
        }

        return originalOnPointerMove(data, context);
    };

    return mode;
}

/**
 * Initialize renderers asynchronously (landscape first for camera, then sprites).
 */
async function initRenderersAsync(
    gl: WebGL2RenderingContext,
    landscapeRenderer: LandscapeRenderer,
    entityRenderer: EntityRenderer,
    _game: Game
): Promise<void> {
    const t0 = performance.now();
    await landscapeRenderer.init(gl);
    debugStats.state.loadTimings.landscape = Math.round(performance.now() - t0);
    debugStats.state.gameLoaded = true;

    await entityRenderer.init(gl);
    debugStats.state.rendererReady = true;
}

/** Expose objects for e2e tests */
function exposeForE2E(viewPoint: any, landscapeRenderer: any, entityRenderer: any, inputManager: any): void {
    (window as any).__settlers_viewpoint__ = viewPoint;
    (window as any).__settlers_landscape__ = landscapeRenderer;
    (window as any).__settlers_entity_renderer__ = entityRenderer;
    (window as any).__settlers_input__ = inputManager;
}

interface UseRendererOptions {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getLayerVisibility: () => LayerVisibility;
    onTileClick: (tile: { x: number; y: number }) => void;
    initialCamera?: { x: number; y: number; zoom: number } | null;
}

/** Handle mode changes and update debug stats */
function handleModeChange(getGame: () => Game | null): (oldMode: string, newMode: string, data?: any) => void {
    return (_oldMode, newMode, data) => {
        debugStats.state.mode = newMode;

        // Update building type
        debugStats.state.placeBuildingType =
            newMode === 'place_building' && data?.buildingType !== undefined ? data.buildingType : 0;

        // Update resource type
        debugStats.state.placeResourceType =
            newMode === 'place_resource' && data?.resourceType !== undefined ? data.resourceType : 0;

        // Update unit type
        debugStats.state.placeUnitType = newMode === 'place_unit' && data?.unitType !== undefined ? data.unitType : 0;

        // Sync with game for backward compatibility
        const game = getGame();
        if (game) {
            game.mode = newMode as any;
            game.placeBuildingType = debugStats.state.placeBuildingType;
        }
    };
}

export function useRenderer({
    canvas,
    getGame,
    getDebugGrid,
    getLayerVisibility,
    onTileClick,
    initialCamera,
}: UseRendererOptions) {
    let renderer: Renderer | null = null;
    let tilePicker: TilePicker | null = null;
    let entityRenderer: EntityRenderer | null = null;
    let landscapeRenderer: LandscapeRenderer | null = null;
    let inputManager: InputManager | null = null;

    // Selection box state for rendering drag selection overlay
    const selectionBox = ref<SelectionBox | null>(null);

    /**
     * Resolve screen coordinates to tile coordinates.
     */
    function resolveTile(screenX: number, screenY: number): TileCoord | null {
        const game = getGame();
        if (!game || !tilePicker || !renderer) return null;
        return tilePicker.screenToTile(screenX, screenY, renderer.viewPoint, game.mapSize, game.groundHeight);
    }

    /**
     * Execute a game command, updating debug stats for tile clicks.
     */
    function executeCommand(command: any): boolean {
        const game = getGame();
        if (!game) return false;

        // Track tile info for debug stats on tile-targeting commands
        if (command.type === 'select_at_tile' || command.type === 'move_selected_units') {
            const x = command.x ?? command.targetX;
            const y = command.y ?? command.targetY;
            if (x !== undefined && y !== undefined) {
                onTileClick({ x, y });
                debugStats.state.hasTile = true;
                debugStats.state.tileX = x;
                debugStats.state.tileY = y;
                const idx = game.mapSize.toIndex(x, y);
                debugStats.state.tileGroundType = game.groundType[idx];
                debugStats.state.tileGroundHeight = game.groundHeight[idx];
            }
        }

        return game.execute(command);
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
        inputManager.registerMode(configurePlaceBuildingMode(getGame, onTileClick));
        inputManager.registerMode(configurePlaceResourceMode(getGame, onTileClick));
        inputManager.registerMode(configurePlaceUnitMode(getGame, onTileClick));
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
            game.mapSize,
            game.groundType,
            game.groundHeight,
            getDebugGrid(),
            game.useProceduralTextures
        );
        renderer.add(landscapeRenderer);

        entityRenderer = new EntityRenderer(game.mapSize, game.groundHeight, game.fileManager, game.groundType);
        entityRenderer.setAnimationService(game.gameLoop.animationService);
        entityRenderer.skipSpriteLoading = game.useProceduralTextures;
        entityRenderer.onSpritesLoaded = () => game.gameLoop.enableTicks();
        renderer.add(entityRenderer);
    }

    /**
     * Initialize GL resources and bind event handlers.
     */
    function initGLAndBindEvents(game: Game): void {
        if (!renderer || !landscapeRenderer || !entityRenderer) return;

        const gl = renderer.gl;
        if (gl) {
            void initRenderersAsync(gl, landscapeRenderer, entityRenderer, game);
        } else {
            debugStats.state.gameLoaded = true;
            if (game.useProceduralTextures) {
                game.gameLoop.enableTicks();
            }
        }

        exposeForE2E(renderer.viewPoint, landscapeRenderer, entityRenderer, inputManager);

        game.eventBus.on('terrain:modified', () => {
            landscapeRenderer?.markTerrainDirty();
        });

        const contextGetter = () => ({
            game: getGame(),
            entityRenderer,
            landscapeRenderer,
            inputManager,
            debugGrid: getDebugGrid(),
            layerVisibility: getLayerVisibility(),
        });

        // Register update callback (input, sound, debug stats — runs before render)
        game.gameLoop.setUpdateCallback(
            createUpdateCallback(contextGetter, renderer, selectionBox)
        );

        // Register render callback (visual sync + GPU draw only)
        game.gameLoop.setRenderCallback(
            createRenderCallback(contextGetter, renderer)
        );
    }

    /**
     * Initialize the renderer for a new game.
     * Sets up renderers, positions camera, and starts the game.
     */
    function initRenderer(): void {
        const game = getGame();
        if (game == null || renderer == null) return;

        debugStats.reset();
        renderer.clear();

        setupRenderers(game);
        initGLAndBindEvents(game);

        // Restore camera from saved state, or find a land tile for initial position
        if (initialCamera) {
            renderer.viewPoint.setRawPosition(initialCamera.x, initialCamera.y);
            renderer.viewPoint.zoomValue = initialCamera.zoom;
        } else {
            const landTile = game.findLandTile();
            if (landTile) {
                renderer.viewPoint.setPosition(landTile.x, landTile.y);
            }
        }

        game.start();
    }

    onMounted(() => {
        const cavEl = canvas.value!;
        // Pass externalInput: true to disable ViewPoint's legacy mouse handlers
        // since we use InputManager for all input handling
        renderer = new Renderer(cavEl, { externalInput: true });
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
        return entityRenderer?.getRace() ?? Race.Roman;
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

    return {
        getRenderer: () => renderer,
        setRace,
        getRace,
        getInputManager,
        getCamera,
        selectionBox,
    };
}

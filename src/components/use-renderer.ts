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
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, type TileCoord } from '@/game/entity';
import { Race } from '@/game/renderer/sprite-metadata';
import { canPlaceBuildingWithTerritory, isPassable } from '@/game/systems/placement';
import { debugStats } from '@/game/debug-stats';
import {
    InputManager,
    SelectMode,
    PlaceBuildingMode,
    type PlaceBuildingModeData,
    PlaceResourceMode,
    type PlaceResourceModeData,
    getDefaultInputConfig,
} from '@/game/input';
import { LayerVisibility } from '@/game/renderer/layer-visibility';
import type { SelectionBox } from '@/game/input/render-state';

/** Context object for render callback - avoids excessive callback parameters */
interface RenderContext {
    game: Game | null;
    entityRenderer: EntityRenderer | null;
    landscapeRenderer: LandscapeRenderer | null;
    inputManager: InputManager | null;
    debugGrid: boolean;
    showTerritoryBorders: boolean;
    layerVisibility: LayerVisibility;
}

/** Update entity renderer state from game */
function syncEntityRendererState(
    er: EntityRenderer, g: Game, ctx: RenderContext, alpha: number
): void {
    er.entities = g.state.entities;
    er.selectedEntityId = g.state.selectedEntityId;
    er.selectedEntityIds = g.state.selectedEntityIds;
    er.unitStates = g.state.unitStates;
    er.buildingStates = g.state.buildingStates;
    er.resourceStates = g.state.resourceStates;
    er.territoryMap = ctx.showTerritoryBorders ? g.territory : null;
    er.territoryVersion = g.territoryVersion;
    er.renderAlpha = alpha;
    er.layerVisibility = ctx.layerVisibility;
}

/** Handle placement mode rendering state */
function updatePlacementModeState(er: EntityRenderer, g: Game, renderState: any): void {
    const mode = debugStats.state.mode;
    er.buildingIndicatorsPlayer = g.currentPlayer;
    er.buildingIndicatorsHasBuildings = g.state.entities.some(
        ent => ent.type === EntityType.Building && ent.player === g.currentPlayer
    );
    er.territoryMap = g.territory;
    er.previewBuildingType = g.placeBuildingType;
    er.previewMaterialType = (mode === 'place_resource') ? debugStats.state.placeResourceType : null;

    const preview = renderState?.preview;
    if (preview?.type === 'building' || preview?.type === 'resource') {
        er.previewTile = { x: preview.x, y: preview.y };
        er.previewValid = preview.valid;
        er.previewVariation = (preview.type === 'resource')
            ? Math.max(0, Math.min((preview.amount ?? 1) - 1, 7))
            : null;
    } else {
        er.previewTile = null;
        er.previewVariation = null;
    }
}

/** Clear placement mode state */
function clearPlacementModeState(er: EntityRenderer): void {
    er.previewTile = null;
    er.previewBuildingType = null;
    er.previewMaterialType = null;
    er.previewVariation = null;
}

/** Create the render callback that runs each frame. */
function createRenderCallback(
    getContext: () => RenderContext,
    renderer: Renderer,
    selectionBox: Ref<SelectionBox | null>
): (alpha: number, deltaSec: number) => void {
    return (alpha: number, deltaSec: number) => {
        const ctx = getContext();
        const { game: g, entityRenderer: er, landscapeRenderer, inputManager } = ctx;

        if (er && g) {
            inputManager?.update(deltaSec);
            syncEntityRendererState(er, g, ctx, alpha);

            const renderState = inputManager?.getRenderState();
            const mode = debugStats.state.mode;
            const inPlacementMode = mode === 'place_building' || mode === 'place_resource';
            er.buildingIndicatorsEnabled = inPlacementMode;

            if (inPlacementMode) {
                updatePlacementModeState(er, g, renderState);
            } else {
                clearPlacementModeState(er);
            }

            selectionBox.value = (renderState?.preview?.type === 'selection_box')
                ? renderState.preview : null;

            if (renderState?.cursor && renderer.canvas) {
                renderer.canvas.style.cursor = renderState.cursor;
            }
        }

        if (landscapeRenderer) landscapeRenderer.debugGrid = ctx.debugGrid;
        if (g) debugStats.updateFromGame(g);

        debugStats.state.cameraX = Math.round(renderer.viewPoint.x * 10) / 10;
        debugStats.state.cameraY = Math.round(renderer.viewPoint.y * 10) / 10;
        debugStats.state.zoom = Math.round(renderer.viewPoint.zoomValue * 100) / 100;
        renderer.viewPoint.zoomSpeed = debugStats.state.zoomSpeed;
        renderer.viewPoint.panSpeed = debugStats.state.panSpeed;
        debugStats.state.canvasWidth = renderer.canvas.width;
        debugStats.state.canvasHeight = renderer.canvas.height;

        renderer.drawOnce();
    };
}

/**
 * Configure the PlaceBuildingMode with validation and debug stats integration.
 */
function configurePlaceBuildingMode(
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): PlaceBuildingMode {
    const placeBuildingMode = new PlaceBuildingMode();
    const originalOnPointerMove = placeBuildingMode.onPointerMove.bind(placeBuildingMode);

    placeBuildingMode.onPointerMove = (data, context) => {
        if (data.tileX !== undefined && data.tileY !== undefined) {
            onTileClick({ x: data.tileX, y: data.tileY });
            debugStats.state.hasTile = true;
            debugStats.state.tileX = data.tileX;
            debugStats.state.tileY = data.tileY;

            const game = getGame();
            if (game) {
                const idx = game.mapSize.toIndex(data.tileX, data.tileY);
                debugStats.state.tileGroundType = game.groundType[idx];
                debugStats.state.tileGroundHeight = game.groundHeight[idx];
            }
        }

        const modeData = context.getModeData<PlaceBuildingModeData>();
        if (modeData && !modeData.validatePlacement) {
            modeData.validatePlacement = (x, y, buildingType) => {
                const game = getGame();
                if (!game) return false;

                const hasBuildings = game.state.entities.some(
                    ent => ent.type === EntityType.Building && ent.player === game.currentPlayer
                );

                return canPlaceBuildingWithTerritory(
                    game.groundType, game.groundHeight, game.mapSize,
                    game.state.tileOccupancy, game.territory,
                    x, y, game.currentPlayer, hasBuildings, buildingType
                );
            };
            context.setModeData(modeData);
        }

        return originalOnPointerMove(data, context);
    };


    return placeBuildingMode;
}

/**
 * Configure PlaceResourceMode with debug stats integration
 */
function configurePlaceResourceMode(
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): PlaceResourceMode {
    const placeResourceMode = new PlaceResourceMode();
    const originalOnPointerMove = placeResourceMode.onPointerMove.bind(placeResourceMode);

    placeResourceMode.onPointerMove = (data, context) => {
        if (data.tileX !== undefined && data.tileY !== undefined) {
            onTileClick({ x: data.tileX, y: data.tileY });
            debugStats.state.hasTile = true;
            debugStats.state.tileX = data.tileX;
            debugStats.state.tileY = data.tileY;

            const game = getGame();
            if (game) {
                const idx = game.mapSize.toIndex(data.tileX, data.tileY);
                debugStats.state.tileGroundType = game.groundType[idx];
                debugStats.state.tileGroundHeight = game.groundHeight[idx];
            }
        }

        const modeData = context.getModeData<PlaceResourceModeData>();
        if (modeData && !modeData.validatePlacement) {
            modeData.validatePlacement = (x, y) => {
                const game = getGame();
                if (!game) return false;
                if (x < 0 || y < 0 || x >= game.mapSize.width || y >= game.mapSize.height) return false;

                const idx = game.mapSize.toIndex(x, y);
                // Must be passable (not sea/rock)
                if (!isPassable(game.groundType[idx])) return false;
                // Must not be occupied
                if (game.state.getEntityAt(x, y)) return false;

                return true;
            };
            context.setModeData(modeData);
        }

        return originalOnPointerMove(data, context);
    };

    return placeResourceMode;
}

/**
 * Initialize renderers asynchronously (landscape first for camera, then sprites).
 */
async function initRenderersAsync(
    gl: WebGL2RenderingContext,
    landscapeRenderer: LandscapeRenderer,
    entityRenderer: EntityRenderer,
    game: Game
): Promise<void> {
    const t0 = performance.now();
    await landscapeRenderer.init(gl);
    debugStats.state.loadTimings.landscape = Math.round(performance.now() - t0);
    debugStats.state.gameLoaded = true;

    await entityRenderer.init(gl);
    debugStats.state.rendererReady = true;

    const animProvider = entityRenderer.getAnimationProvider();
    if (animProvider) {
        game.gameLoop.setAnimationProvider(animProvider);
    }
}

/** Expose objects for e2e tests */
function exposeForE2E(
    viewPoint: any, landscapeRenderer: any, entityRenderer: any, inputManager: any
): void {
    (window as any).__settlers_viewpoint__ = viewPoint;
    (window as any).__settlers_landscape__ = landscapeRenderer;
    (window as any).__settlers_entity_renderer__ = entityRenderer;
    (window as any).__settlers_input__ = inputManager;
}

interface UseRendererOptions {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getShowTerritoryBorders: () => boolean;
    getLayerVisibility: () => LayerVisibility;
    onTileClick: (tile: { x: number; y: number }) => void;
}

/** Handle mode changes and update debug stats */
function handleModeChange(
    getGame: () => Game | null
): (oldMode: string, newMode: string, data?: any) => void {
    return (_oldMode, newMode, data) => {
        debugStats.state.mode = newMode;

        // Update building type
        debugStats.state.placeBuildingType =
            (newMode === 'place_building' && data?.buildingType !== undefined)
                ? data.buildingType : 0;

        // Update resource type
        debugStats.state.placeResourceType =
            (newMode === 'place_resource' && data?.resourceType !== undefined)
                ? data.resourceType : 0;

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
    getShowTerritoryBorders,
    getLayerVisibility,
    onTileClick,
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
        inputManager.attach();

        // Connect camera mode to the ViewPoint
        if (renderer) {
            inputManager.getCamera().setViewPoint(renderer.viewPoint);
        }
    }

    /**
     * Initialize the renderer.
     * Landscape loads first for immediate camera control, then sprites load in background.
     */
    function initRenderer(): void {
        const game = getGame();
        if (game == null || renderer == null) return;

        renderer.clear();

        landscapeRenderer = new LandscapeRenderer(
            game.fileManager,
            game.mapSize,
            game.groundType,
            game.groundHeight,
            getDebugGrid(),
            game.useProceduralTextures
        );
        renderer.add(landscapeRenderer);

        entityRenderer = new EntityRenderer(
            game.mapSize,
            game.groundHeight,
            game.fileManager,
            game.groundType
        );
        renderer.add(entityRenderer);

        // Initialize renderers asynchronously
        const gl = renderer.gl;
        if (gl) {
            initRenderersAsync(gl, landscapeRenderer, entityRenderer, game);
        }

        const landTile = game.findLandTile();
        if (landTile) {
            renderer.viewPoint.setPosition(landTile.x, landTile.y);
        }

        exposeForE2E(renderer.viewPoint, landscapeRenderer, entityRenderer, inputManager);

        // Set up terrain modification callback
        game.gameLoop.setTerrainModifiedCallback(() => {
            landscapeRenderer?.markTerrainDirty();
        });

        game.gameLoop.setRenderCallback(createRenderCallback(
            () => ({
                game: getGame(),
                entityRenderer,
                landscapeRenderer,
                inputManager,
                debugGrid: getDebugGrid(),
                showTerritoryBorders: getShowTerritoryBorders(),
                layerVisibility: getLayerVisibility(),
            }),
            renderer,
            selectionBox
        ));

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
        if (game) game.stop();

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

    return {
        getRenderer: () => renderer,
        setRace,
        getRace,
        getInputManager,
        selectionBox,
    };
}

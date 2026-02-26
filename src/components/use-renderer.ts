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
import type { ViewPoint } from '@/game/renderer/view-point';
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
    BuildingAdjustMode,
    getDefaultInputConfig,
} from '@/game/input';
import { StackPositions } from '@/game/features/inventory/stack-positions';
import { EntranceAdjustHandler, SpriteLayerAdjustHandler, StackAdjustHandler } from '@/game/features/building-adjust';
import { LayerVisibility } from '@/game/renderer/layer-visibility';
// eslint-disable-next-line sonarjs/deprecation -- legacy preview types kept for backward compat branch
import type { SelectionBox, BuildingPreview, ResourcePreview, ModeRenderState } from '@/game/input/render-state';
import {
    createRenderContext,
    OverlayRenderLayer,
    type BuildingOverlayRenderData,
    type ServiceAreaRenderData,
    type TerritoryDotRenderData,
} from '@/game/renderer/render-context';
import { getBuildingVisualState, BuildingConstructionPhase } from '@/game/features/building-construction';
import { PIXELS_TO_WORLD } from '@/game/renderer/sprite-metadata';
import { EntityType, type BuildingType } from '@/game/entity';
import { getOverlayFrame } from '@/game/systems/building-overlays';

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
    // Collect service areas for selected hub buildings
    const serviceAreas: ServiceAreaRenderData[] = [];
    const sam = g.services.serviceAreaManager;
    for (const id of g.state.selection.selectedEntityIds) {
        const entity = g.state.getEntity(id);
        if (entity && entity.type === EntityType.Building) {
            const sa = sam.getServiceArea(id);
            if (sa) {
                serviceAreas.push({ centerX: sa.centerX, centerY: sa.centerY, radius: sa.radius });
            }
        }
    }

    // Collect territory boundary dots (only when territory display is enabled)
    const territoryDots: readonly TerritoryDotRenderData[] = ctx.layerVisibility.showTerritory
        ? g.services.territoryManager.getBoundaryDots()
        : [];

    // Feature-specific computation happens here (glue layer), not in the renderer.
    // The renderer receives pre-computed BuildingRenderState via the context.
    const bsm = g.services.buildingStateManager;
    const animService = g.services.animationService;

    const renderContext = createRenderContext()
        .entities(g.state.entities)
        .unitStates(g.state.unitStates)
        .resourceStates(g.state.resources.states)
        .buildingRenderStateGetter(entityId => {
            const state = bsm.getBuildingState(entityId);
            const vs = getBuildingVisualState(state);
            return {
                useConstructionSprite: vs.useConstructionSprite,
                verticalProgress: vs.verticalProgress,
            };
        })
        .buildingOverlaysGetter(entityId => {
            return resolveBuildingOverlays(entityId, g, er);
        })
        .animationStateGetter(entityId => animService.getState(entityId))
        .selection({
            primaryId: g.state.selection.selectedEntityId,
            ids: g.state.selection.selectedEntityIds,
        })
        .selectedServiceAreas(serviceAreas)
        .territoryDots(territoryDots)
        .alpha(alpha)
        .layerVisibility(ctx.layerVisibility)
        .settings({
            showBuildingFootprint: ctx.layerVisibility.showBuildingFootprint,
            disablePlayerTinting: g.settings.state.disablePlayerTinting,
            antialias: g.settings.state.antialias,
        })
        .groundHeight(g.terrain.groundHeight)
        .groundType(g.terrain.groundType)
        .mapSize(g.terrain.width, g.terrain.height)
        .viewPoint(viewPoint)
        .build();

    // Use the new setContext method
    er.setContext(renderContext);
}

const EMPTY_OVERLAY_DATA: readonly BuildingOverlayRenderData[] = [];

/**
 * Resolve all overlay render data for a building entity.
 * Produces both construction overlays (background sprite during CompletedRising)
 * and custom overlays from the BuildingOverlayManager.
 */
function resolveBuildingOverlays(entityId: number, g: Game, er: EntityRenderer): readonly BuildingOverlayRenderData[] {
    const result: BuildingOverlayRenderData[] = [];
    resolveConstructionOverlay(entityId, g, er, result);
    resolveCustomOverlays(entityId, g, er, result);
    return result.length > 0 ? result : EMPTY_OVERLAY_DATA;
}

/** During CompletedRising, emit the construction sprite behind the rising completed building. */
function resolveConstructionOverlay(
    entityId: number,
    g: Game,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    const buildingState = g.services.buildingStateManager.getBuildingState(entityId);
    const vs = getBuildingVisualState(buildingState);
    if (vs.phase !== BuildingConstructionPhase.CompletedRising || !er.spriteManager) return;

    const entity = g.state.getEntity(entityId);
    if (!entity) return;

    const constructionSprite = er.spriteManager.getBuildingConstruction(entity.subType as BuildingType, entity.race);
    if (!constructionSprite) return;

    out.push({
        sprite: constructionSprite,
        worldOffsetX: 0,
        worldOffsetY: 0,
        layer: OverlayRenderLayer.BehindBuilding,
        teamColored: true,
        verticalProgress: 1.0,
    });
}

/** Resolve custom overlays (smoke, wheels, etc.) from the BuildingOverlayManager. */
function resolveCustomOverlays(entityId: number, g: Game, er: EntityRenderer, out: BuildingOverlayRenderData[]): void {
    const instances = g.services.buildingOverlayManager.getOverlays(entityId);
    if (!instances) return;

    for (const inst of instances) {
        if (!inst.active) continue;

        const spriteRef = inst.def.spriteRef;
        const frames = er.spriteManager?.getOverlayFrames(
            spriteRef.gfxFile,
            spriteRef.jobIndex,
            spriteRef.directionIndex ?? 0
        );
        if (!frames || frames.length === 0) continue;

        const frameIndex = getOverlayFrame(inst);
        const sprite = frames[Math.min(frameIndex, frames.length - 1)]!;

        out.push({
            sprite,
            worldOffsetX: inst.def.pixelOffsetX * PIXELS_TO_WORLD,
            worldOffsetY: inst.def.pixelOffsetY * PIXELS_TO_WORLD,
            layer: inst.def.layer as number as OverlayRenderLayer,
            teamColored: inst.def.teamColored ?? false,
            verticalProgress: 1.0,
        });
    }
}

/** Handle placement mode rendering state using consolidated preview */
function updatePlacementModeState(er: EntityRenderer, renderState: ModeRenderState | null | undefined): void {
    const preview = renderState?.preview;

    // Handle new unified PlacementPreview type
    if (preview?.type === 'placement') {
        const amount = (preview.extra?.['amount'] as number | undefined) ?? 1;
        const variation = preview.entityType === 'resource' ? Math.max(0, Math.min(amount - 1, 7)) : undefined;

        er.placementPreview = {
            tile: { x: preview.x, y: preview.y },
            valid: preview.valid,
            entityType: preview.entityType,
            subType: preview.subType,
            race: preview.race,
            variation,
        };
    } else if (preview?.type === 'building') {
        // Handle legacy BuildingPreview for backward compatibility
        // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated -- legacy union type
        const buildingPreview: BuildingPreview = preview;
        er.placementPreview = {
            tile: { x: buildingPreview.x, y: buildingPreview.y },
            valid: buildingPreview.valid,
            entityType: 'building',
            subType: buildingPreview.buildingType,
        };
    } else if (preview?.type === 'resource') {
        // Handle legacy ResourcePreview for backward compatibility
        // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated -- legacy union type
        const resourcePreview: ResourcePreview = preview;
        const amount = resourcePreview.amount ?? 1;
        er.placementPreview = {
            tile: { x: resourcePreview.x, y: resourcePreview.y },
            valid: resourcePreview.valid,
            entityType: 'resource',
            subType: resourcePreview.materialType,
            variation: Math.max(0, Math.min(amount - 1, 7)),
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

            if (renderState?.cursor) {
                renderer.canvas.style.cursor = renderState.cursor;
            }
        }

        // Debug stats + sound
        if (g) {
            debugStats.updateFromGame(g, g.settings);
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
            const mode = g.viewState.state.mode;
            const inPlacementMode = mode === 'place_building' || mode === 'place_resource' || mode === 'place_unit';
            er.buildingIndicatorsEnabled = inPlacementMode;

            if (inPlacementMode) {
                updatePlacementModeState(er, renderState);
            } else {
                clearPlacementModeState(er);
            }

            er.tileHighlights = renderState?.highlights ?? [];
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
        const idx = game.terrain.toIndex(tileX, tileY);
        debugStats.state.tileGroundType = game.terrain.groundType[idx]!;
        debugStats.state.tileGroundHeight = game.terrain.groundHeight[idx]!;
    }
}

/**
 * Create BuildingAdjustMode with lazy game dependency resolution.
 * Registers all three adjust handlers: entrance, sprite layers, and stacks.
 */
function createBuildingAdjustMode(getGame: () => Game | null): BuildingAdjustMode {
    const stackPositions = new StackPositions();
    let handlers: readonly import('@/game/features/building-adjust/types').BuildingAdjustHandler[] | null = null;
    let connected = false;

    return new BuildingAdjustMode(() => {
        const game = getGame();
        if (!game) return null;

        if (!connected) {
            game.services.inventoryVisualizer.setStackPositions(stackPositions);
            connected = true;
        }

        if (!handlers) {
            handlers = [
                new EntranceAdjustHandler(),
                new SpriteLayerAdjustHandler(game.services.overlayRegistry),
                new StackAdjustHandler(stackPositions, game.services.inventoryVisualizer),
            ];
        }

        return {
            gameState: game.state,
            handlers,
        };
    });
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
    // Start IndexedDB cache read in parallel with landscape init
    entityRenderer.spriteManager?.prefetchCache();

    const t0 = performance.now();
    await landscapeRenderer.init(gl);
    debugStats.state.loadTimings.landscape = Math.round(performance.now() - t0);
    debugStats.state.gameLoaded = true;

    await entityRenderer.init(gl);
    // Note: entityRenderer.init() returns immediately — sprites load in background.
    // markRendererReady() is called from the onSpritesLoaded callback instead.
}

/** Expose objects for e2e tests */
function exposeForE2E(
    viewPoint: ViewPoint,
    landscapeRenderer: LandscapeRenderer,
    entityRenderer: EntityRenderer,
    inputManager: InputManager | null
): void {
    const bridge = (window.__settlers__ ??= {});
    bridge.viewpoint = viewPoint;
    bridge.landscape = landscapeRenderer;
    bridge.entityRenderer = entityRenderer;
    bridge.input = inputManager ?? undefined;
}

interface UseRendererOptions {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getLayerVisibility: () => LayerVisibility;
    onTileClick: (tile: { x: number; y: number }) => void;
    initialCamera?: { x: number; y: number; zoom: number } | null;
}

/** Handle mode changes and update game view state */
function handleModeChange(
    getGame: () => Game | null
): (oldMode: string, newMode: string, data?: Record<string, unknown>) => void {
    return (_oldMode, newMode, data) => {
        const game = getGame();
        if (!game) return;

        const vs = game.viewState.state;
        vs.mode = newMode;

        // Update building type
        vs.placeBuildingType =
            newMode === 'place_building' && data?.['buildingType'] !== undefined ? (data['buildingType'] as number) : 0;

        // Update resource type
        vs.placeResourceType =
            newMode === 'place_resource' && data?.['resourceType'] !== undefined ? (data['resourceType'] as number) : 0;

        // Update unit type
        vs.placeUnitType =
            newMode === 'place_unit' && data?.['unitType'] !== undefined ? (data['unitType'] as number) : 0;

        // Sync with game for backward compatibility
        game.mode = newMode;
        game.placeBuildingType = vs.placeBuildingType;
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
            game.useProceduralTextures
        );
        renderer.add(landscapeRenderer);

        entityRenderer = new EntityRenderer(
            game.terrain.mapSize,
            game.terrain.groundHeight,
            game.fileManager,
            game.terrain.groundType,
            {
                isBuildableTerrain: isBuildable,
                isMineBuildableTerrain: isMineBuildable,
                computeSlopeDifficulty,
                computeHeightRange,
                maxSlopeDiff: MAX_SLOPE_DIFF,
            }
        );
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
        if (!renderer || !landscapeRenderer || !entityRenderer) return;

        const gl = renderer.gl;
        if (gl) {
            rendererInitStart = performance.now();
            void initRenderersAsync(gl, landscapeRenderer, entityRenderer, game);
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
            landscapeRenderer,
            inputManager,
            debugGrid: getDebugGrid(),
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
        renderer.clear();

        // Inject game settings into ViewPoint and InputManager
        renderer.viewPoint.setSettings(game.settings.state);
        if (inputManager) inputManager.setSettings(game.settings.state);

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

    function getDecoLabels(): Array<{ screenX: number; screenY: number; type: number; hue: number }> {
        return entityRenderer?.debugDecoLabels ?? [];
    }

    return {
        getRenderer: () => renderer,
        setRace,
        getRace,
        getInputManager,
        getCamera,
        getDecoLabels,
        selectionBox,
    };
}

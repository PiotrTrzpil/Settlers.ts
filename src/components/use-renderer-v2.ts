/**
 * use-renderer-v2.ts - Refactored renderer composable using InputManager
 *
 * This version uses the new input system for cleaner, more maintainable code.
 */

import { ref, watch, onMounted, onUnmounted, computed, type Ref, type ComputedRef } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, BuildingType, getBuildingSize, type TileCoord } from '@/game/entity';
import { Race } from '@/game/renderer/sprite-metadata';
import { canPlaceBuildingWithTerritory } from '@/game/systems/placement';
import { debugStats } from '@/game/debug-stats';
import {
    InputManager,
    SelectMode,
    PlaceBuildingMode,
    type PlaceBuildingModeData,
    getDefaultInputConfig,
    MouseButton,
} from '@/game/input';

/**
 * Options for useRendererV2 composable.
 */
interface UseRendererV2Options {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getShowTerritoryBorders: () => boolean;
    onTileClick: (tile: TileCoord) => void;
}

/**
 * Refactored renderer composable with new input system.
 */
export function useRendererV2({
    canvas,
    getGame,
    getDebugGrid,
    getShowTerritoryBorders,
    onTileClick,
}: UseRendererV2Options) {
    // Core rendering
    let renderer: Renderer | null = null;
    let tilePicker: TilePicker | null = null;
    let entityRenderer: EntityRenderer | null = null;
    let landscapeRenderer: LandscapeRenderer | null = null;

    // Input management
    let inputManager: InputManager | null = null;

    // Reactive state
    const currentMode = ref<string>('select');
    const currentTile = ref<TileCoord | null>(null);

    /**
     * Initialize the renderer with a game.
     */
    function initRenderer(): void {
        const game = getGame();
        if (game == null || renderer == null) return;

        // Clear old renderers
        renderer.clear();

        // Create landscape renderer
        landscapeRenderer = new LandscapeRenderer(
            game.fileManager,
            game.mapSize,
            game.groundType,
            game.groundHeight,
            getDebugGrid(),
            game.useProceduralTextures
        );
        renderer.add(landscapeRenderer);

        // Create entity renderer
        entityRenderer = new EntityRenderer(
            game.mapSize,
            game.groundHeight,
            game.fileManager,
            game.groundType
        );
        renderer.add(entityRenderer);

        // Initialize renderer
        void renderer.init().then(() => {
            debugStats.state.rendererReady = true;
        });

        debugStats.state.gameLoaded = true;

        // Center camera on first land tile
        const landTile = game.findLandTile();
        if (landTile && inputManager) {
            inputManager.getCamera().setPosition(landTile.x, landTile.y);
        }

        // Expose for e2e tests and debug
        (window as any).__settlers_viewpoint__ = renderer.viewPoint;
        (window as any).__settlers_landscape__ = landscapeRenderer;

        // Set up terrain modification callback
        game.gameLoop.setTerrainModifiedCallback(() => {
            landscapeRenderer?.markTerrainDirty();
        });

        // Set up render callback
        game.gameLoop.setRenderCallback((alpha: number, deltaSec: number) => {
            const g = getGame();
            if (!g || !entityRenderer || !renderer) return;

            // Update input manager
            inputManager?.update(deltaSec);

            // Sync camera from input manager to viewPoint
            if (inputManager) {
                const camera = inputManager.getCamera();
                renderer.viewPoint.setRawPosition(camera.x, camera.y);
                renderer.viewPoint.zoomValue = 0.1 / camera.zoom;
            }

            // Update entity renderer state
            entityRenderer.entities = g.state.entities;
            entityRenderer.selectedEntityId = g.state.selectedEntityId;
            entityRenderer.selectedEntityIds = g.state.selectedEntityIds;
            entityRenderer.unitStates = g.state.unitStates;
            entityRenderer.buildingStates = g.state.buildingStates;
            entityRenderer.territoryMap = getShowTerritoryBorders() ? g.territory : null;
            entityRenderer.territoryVersion = g.territoryVersion;
            entityRenderer.renderAlpha = alpha;

            // Building placement mode handling
            const inPlacementMode = currentMode.value === 'place_building';
            entityRenderer.buildingIndicatorsEnabled = inPlacementMode;

            if (inPlacementMode) {
                entityRenderer.buildingIndicatorsPlayer = g.currentPlayer;
                entityRenderer.buildingIndicatorsHasBuildings = g.state.entities.some(
                    ent => ent.type === EntityType.Building && ent.player === g.currentPlayer
                );
                entityRenderer.territoryMap = g.territory;

                // Get placement preview from input manager
                const modeData = inputManager?.getCurrentMode()?.name === 'place_building'
                    ? (inputManager as any).modeData.get('place_building') as PlaceBuildingModeData | undefined
                    : undefined;

                if (modeData) {
                    entityRenderer.previewTile = { x: modeData.previewX, y: modeData.previewY };
                    entityRenderer.previewBuildingType = modeData.buildingType;
                    entityRenderer.previewValid = modeData.previewValid;
                } else {
                    entityRenderer.previewTile = null;
                    entityRenderer.previewBuildingType = null;
                }
            } else {
                entityRenderer.previewTile = null;
                entityRenderer.previewBuildingType = null;
            }

            // Update landscape debug grid
            if (landscapeRenderer) {
                landscapeRenderer.debugGrid = getDebugGrid();
            }

            // Update debug stats
            if (g) {
                debugStats.updateFromGame(g);
            }

            const vp = renderer.viewPoint;
            debugStats.state.cameraX = Math.round(vp.x * 10) / 10;
            debugStats.state.cameraY = Math.round(vp.y * 10) / 10;
            debugStats.state.zoom = Math.round(vp.zoomValue * 100) / 100;
            debugStats.state.canvasWidth = renderer.canvas.width;
            debugStats.state.canvasHeight = renderer.canvas.height;

            // Sync pan/zoom speed
            vp.zoomSpeed = debugStats.state.zoomSpeed;
            vp.panSpeed = debugStats.state.panSpeed;

            vp.update(deltaSec);
            renderer.drawOnce();
        });

        game.start();
    }

    /**
     * Initialize input manager.
     */
    function initInputManager(): void {
        if (!canvas.value) return;

        // Create tile resolver function
        const tileResolver = (screenX: number, screenY: number): TileCoord | null => {
            const game = getGame();
            if (!game || !tilePicker || !renderer) return null;
            return tilePicker.screenToTile(screenX, screenY, renderer.viewPoint, game.mapSize, game.groundHeight);
        };

        // Create command executor function
        const commandExecutor = (command: any): boolean => {
            const game = getGame();
            if (!game) return false;

            // Handle special commands
            if (command.type === 'select_at_tile') {
                const entity = game.state.getEntityAt(command.x, command.y);
                return game.execute({ type: 'select', entityId: entity?.id ?? null });
            }

            return game.execute(command);
        };

        // Create input manager
        inputManager = new InputManager({
            target: canvas as Ref<HTMLElement | null>,
            config: getDefaultInputConfig(),
            tileResolver,
            commandExecutor,
            initialMode: 'select',
            onModeChange: (oldMode, newMode, data) => {
                currentMode.value = newMode;
                const game = getGame();
                if (game) {
                    game.mode = newMode as any;
                    if (newMode === 'place_building' && data?.buildingType !== undefined) {
                        game.placeBuildingType = data.buildingType;
                    }
                }
            },
        });

        // Register modes with custom behavior
        const selectMode = new SelectMode();
        inputManager.registerMode(selectMode);

        const placeBuildingMode = new PlaceBuildingMode();
        inputManager.registerMode(placeBuildingMode);

        // Set up placement validator
        inputManager.setCommandExecutor((command: any) => {
            const game = getGame();
            if (!game) return false;

            if (command.type === 'select_at_tile') {
                const entity = game.state.getEntityAt(command.x, command.y);
                return game.execute({ type: 'select', entityId: entity?.id ?? null });
            }

            return game.execute(command);
        });

        // Attach event listeners
        inputManager.attach();

        // Update current tile on mouse move
        const updateCurrentTile = () => {
            if (!inputManager) return;
            const state = inputManager.getState();
            const tile = tileResolver(state.mouseX.value, state.mouseY.value);
            currentTile.value = tile;

            if (tile) {
                debugStats.state.hasTile = true;
                debugStats.state.tileX = tile.x;
                debugStats.state.tileY = tile.y;

                const game = getGame();
                if (game) {
                    const idx = game.mapSize.toIndex(tile.x, tile.y);
                    debugStats.state.tileGroundType = game.groundType[idx];
                    debugStats.state.tileGroundHeight = game.groundHeight[idx];
                }
            } else {
                debugStats.state.hasTile = false;
            }

            // Notify external handler
            if (tile) {
                onTileClick(tile);
            }
        };

        // Override pointer move to also update current tile
        const originalPointermove = canvas.value.onpointermove;
        canvas.value.addEventListener('pointermove', updateCurrentTile);
    }

    // Mount/unmount lifecycle
    onMounted(() => {
        const cavEl = canvas.value;
        if (!cavEl) return;

        // Create renderer with external input flag (we're using InputManager)
        renderer = new Renderer(cavEl, { externalInput: true });
        tilePicker = new TilePicker(cavEl);

        // Initialize input system
        initInputManager();

        // Initialize renderer if game is ready
        initRenderer();
    });

    // Watch for game changes
    watch(getGame, () => {
        initRenderer();
    });

    // Cleanup
    onUnmounted(() => {
        const game = getGame();
        if (game) game.stop();

        inputManager?.destroy();
        inputManager = null;

        if (renderer) {
            renderer.destroy();
            renderer = null;
        }
    });

    /**
     * Switch to a different race for building sprites.
     */
    async function setRace(race: Race): Promise<boolean> {
        if (!entityRenderer) return false;
        return entityRenderer.setRace(race);
    }

    /**
     * Get the current race being used for building sprites.
     */
    function getRace(): Race {
        return entityRenderer?.getRace() ?? Race.Roman;
    }

    /**
     * Switch to select mode.
     */
    function selectMode(): void {
        inputManager?.switchMode('select');
    }

    /**
     * Switch to building placement mode.
     */
    function placeBuildingMode(buildingType: BuildingType): void {
        const game = getGame();
        inputManager?.switchMode('place_building', {
            buildingType,
            player: game?.currentPlayer ?? 0,
        });
    }

    /**
     * Get the current mode.
     */
    function getMode(): string {
        return currentMode.value;
    }

    return {
        getRenderer: () => renderer,
        setRace,
        getRace,
        selectMode,
        placeBuildingMode,
        getMode,
        currentTile,
    };
}

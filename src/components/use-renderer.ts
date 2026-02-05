/**
 * use-renderer.ts - Renderer composable with integrated InputManager
 *
 * This composable sets up the WebGL renderer and handles all input
 * through the new InputManager system.
 */

import { watch, onMounted, onUnmounted, type Ref } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, getBuildingSize, type TileCoord } from '@/game/entity';
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
    HANDLED,
    UNHANDLED,
} from '@/game/input';
import { LayerVisibility } from '@/game/renderer/layer-visibility';

interface UseRendererOptions {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getShowTerritoryBorders: () => boolean;
    getLayerVisibility: () => LayerVisibility;
    onTileClick: (tile: { x: number; y: number }) => void;
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

    // Formation offsets for unit movement
    const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
        [0, 0],
        [1, 0], [0, 1], [-1, 0], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1],
        [2, 0], [0, 2], [-2, 0], [0, -2],
        [2, 1], [1, 2], [-1, 2], [-2, 1],
        [-2, -1], [-1, -2], [1, -2], [2, -1],
        [2, 2], [-2, 2], [2, -2], [-2, -2],
    ];

    /**
     * Resolve screen coordinates to tile coordinates.
     */
    function resolveTile(screenX: number, screenY: number): TileCoord | null {
        const game = getGame();
        if (!game || !tilePicker || !renderer) return null;
        return tilePicker.screenToTile(screenX, screenY, renderer.viewPoint, game.mapSize, game.groundHeight);
    }

    /**
     * Execute a game command.
     */
    function executeCommand(command: any): boolean {
        const game = getGame();
        if (!game) return false;
        return game.execute(command);
    }

    /**
     * Handle unit movement commands with formation.
     */
    function handleMoveCommand(tileX: number, tileY: number): void {
        const game = getGame();
        if (!game) return;

        const units: number[] = [];
        for (const entityId of game.state.selectedEntityIds) {
            const entity = game.state.getEntity(entityId);
            if (entity && entity.type === EntityType.Unit) {
                units.push(entity.id);
            }
        }

        for (let i = 0; i < units.length; i++) {
            const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
            game.execute({
                type: 'move_unit',
                entityId: units[i],
                targetX: tileX + offset[0],
                targetY: tileY + offset[1],
            });
        }
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
            onModeChange: (oldMode, newMode, data) => {
                const game = getGame();
                if (game) {
                    game.mode = newMode as any;
                    if (newMode === 'place_building' && data?.buildingType !== undefined) {
                        game.placeBuildingType = data.buildingType;
                    }
                }
            },
        });

        // Create and register SelectMode with game-specific behavior
        const selectMode = new SelectMode();

        // Override pointer up for selection and movement
        selectMode.onPointerUp = (data, context) => {
            // Update debug stats with tile info
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

            // Left click: select entity
            if (data.button === MouseButton.Left && !context.state.drag.value?.isDragging) {
                if (data.tileX !== undefined && data.tileY !== undefined) {
                    const game = getGame();
                    if (game) {
                        const entity = game.state.getEntityAt(data.tileX, data.tileY);
                        game.execute({ type: 'select', entityId: entity?.id ?? null });
                    }
                }
                return HANDLED;
            }

            // Right click: move units
            if (data.button === MouseButton.Right) {
                if (data.tileX !== undefined && data.tileY !== undefined) {
                    handleMoveCommand(data.tileX, data.tileY);
                }
                return HANDLED;
            }

            return UNHANDLED;
        };

        // Override drag end for box selection
        selectMode.onDragEnd = (data, _context) => {
            if (data.button === MouseButton.Left && data.isDragging) {
                if (data.startTileX !== undefined && data.startTileY !== undefined &&
                    data.currentTileX !== undefined && data.currentTileY !== undefined) {
                    const game = getGame();
                    if (game) {
                        game.execute({
                            type: 'select_area',
                            x1: data.startTileX,
                            y1: data.startTileY,
                            x2: data.currentTileX,
                            y2: data.currentTileY,
                        });
                    }
                }
                return HANDLED;
            }
            return UNHANDLED;
        };

        inputManager.registerMode(selectMode);

        // Create PlaceBuildingMode with validation
        const placeBuildingMode = new PlaceBuildingMode();

        // Override pointer move for placement preview
        placeBuildingMode.onPointerMove = (data, context) => {
            if (data.tileX === undefined || data.tileY === undefined) return UNHANDLED;

            const modeData = context.getModeData<PlaceBuildingModeData>();
            if (!modeData) return UNHANDLED;

            const game = getGame();
            if (!game) return UNHANDLED;

            // Update debug stats
            onTileClick({ x: data.tileX, y: data.tileY });
            debugStats.state.hasTile = true;
            debugStats.state.tileX = data.tileX;
            debugStats.state.tileY = data.tileY;
            const idx = game.mapSize.toIndex(data.tileX, data.tileY);
            debugStats.state.tileGroundType = game.groundType[idx];
            debugStats.state.tileGroundHeight = game.groundHeight[idx];

            // Calculate building anchor position
            const size = getBuildingSize(modeData.buildingType);
            const anchorX = Math.round(data.tileX - (size.width - 1) / 2);
            const anchorY = Math.round(data.tileY - (size.height - 1) / 2);

            // Clamp to map bounds
            const clampedX = Math.max(0, Math.min(game.mapSize.width - size.width, anchorX));
            const clampedY = Math.max(0, Math.min(game.mapSize.height - size.height, anchorY));

            modeData.previewX = clampedX;
            modeData.previewY = clampedY;

            // Validate placement
            const hasBuildings = game.state.entities.some(
                ent => ent.type === EntityType.Building && ent.player === game.currentPlayer
            );
            modeData.previewValid = canPlaceBuildingWithTerritory(
                game.groundType, game.groundHeight, game.mapSize,
                game.state.tileOccupancy, game.territory,
                clampedX, clampedY, game.currentPlayer, hasBuildings,
                modeData.buildingType
            );

            context.setModeData(modeData);
            return HANDLED;
        };

        // Override pointer up for building placement
        placeBuildingMode.onPointerUp = (data, context) => {
            const modeData = context.getModeData<PlaceBuildingModeData>();
            if (!modeData) return UNHANDLED;

            if (data.button === MouseButton.Left) {
                if (modeData.previewValid) {
                    const game = getGame();
                    if (game) {
                        game.execute({
                            type: 'place_building',
                            buildingType: modeData.buildingType,
                            x: modeData.previewX,
                            y: modeData.previewY,
                            player: game.currentPlayer,
                        });
                    }
                }
                return HANDLED;
            }

            if (data.button === MouseButton.Right) {
                context.switchMode('select');
                return HANDLED;
            }

            return UNHANDLED;
        };

        inputManager.registerMode(placeBuildingMode);
        inputManager.attach();
    }

    /**
     * Initialize the renderer.
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

        void renderer.init().then(() => {
            debugStats.state.rendererReady = true;
            // Set up animation provider after sprites are loaded
            const animProvider = entityRenderer?.getAnimationProvider();
            if (animProvider && game) {
                game.gameLoop.setAnimationProvider(animProvider);
            }
        });

        debugStats.state.gameLoaded = true;

        const landTile = game.findLandTile();
        if (landTile) {
            renderer.viewPoint.setPosition(landTile.x, landTile.y);
        }

        // Expose for e2e tests
        (window as any).__settlers_viewpoint__ = renderer.viewPoint;
        (window as any).__settlers_landscape__ = landscapeRenderer;

        // Set up terrain modification callback
        game.gameLoop.setTerrainModifiedCallback(() => {
            landscapeRenderer?.markTerrainDirty();
        });

        const r = renderer;
        game.gameLoop.setRenderCallback((alpha: number, deltaSec: number) => {
            const g = getGame();
            if (entityRenderer && g) {
                // Update input manager
                inputManager?.update(deltaSec);

                entityRenderer.entities = g.state.entities;
                entityRenderer.selectedEntityId = g.state.selectedEntityId;
                entityRenderer.selectedEntityIds = g.state.selectedEntityIds;
                entityRenderer.unitStates = g.state.unitStates;
                entityRenderer.buildingStates = g.state.buildingStates;
                entityRenderer.territoryMap = getShowTerritoryBorders() ? g.territory : null;
                entityRenderer.territoryVersion = g.territoryVersion;
                entityRenderer.renderAlpha = alpha;
                entityRenderer.layerVisibility = getLayerVisibility();

                // Get render state from input manager
                const renderState = inputManager?.getRenderState();

                // Building placement indicators
                const inPlacementMode = g.mode === 'place_building';
                entityRenderer.buildingIndicatorsEnabled = inPlacementMode;

                if (inPlacementMode) {
                    entityRenderer.buildingIndicatorsPlayer = g.currentPlayer;
                    entityRenderer.buildingIndicatorsHasBuildings = g.state.entities.some(
                        ent => ent.type === EntityType.Building && ent.player === g.currentPlayer
                    );
                    entityRenderer.territoryMap = g.territory;

                    // Get building preview from render state
                    const preview = renderState?.preview;
                    if (preview?.type === 'building') {
                        entityRenderer.previewTile = { x: preview.x, y: preview.y };
                        entityRenderer.previewBuildingType = preview.buildingType;
                        entityRenderer.previewValid = preview.valid;
                    }
                } else {
                    entityRenderer.previewTile = null;
                    entityRenderer.previewBuildingType = null;
                }

                // Update cursor based on render state
                if (renderState?.cursor && r.canvas) {
                    r.canvas.style.cursor = renderState.cursor;
                }
            }

            if (landscapeRenderer) {
                landscapeRenderer.debugGrid = getDebugGrid();
            }

            if (g) {
                debugStats.updateFromGame(g);
            }

            debugStats.state.cameraX = Math.round(r.viewPoint.x * 10) / 10;
            debugStats.state.cameraY = Math.round(r.viewPoint.y * 10) / 10;
            debugStats.state.zoom = Math.round(r.viewPoint.zoomValue * 100) / 100;
            r.viewPoint.zoomSpeed = debugStats.state.zoomSpeed;
            r.viewPoint.panSpeed = debugStats.state.panSpeed;
            debugStats.state.canvasWidth = r.canvas.width;
            debugStats.state.canvasHeight = r.canvas.height;

            r.viewPoint.update(deltaSec);
            r.drawOnce();
        });

        game.start();
    }

    onMounted(() => {
        const cavEl = canvas.value!;
        renderer = new Renderer(cavEl);
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
    };
}

import { watch, onMounted, onUnmounted, type Ref } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, BuildingType } from '@/game/entity';
import { Race } from '@/game/renderer/sprite-metadata';
import { canPlaceBuildingWithTerritory } from '@/game/systems/placement';
import { debugStats } from '@/game/debug-stats';

const DRAG_THRESHOLD = 5;

const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [-2, -1], [-1, -2], [1, -2], [2, -1],
    [2, 2], [-2, 2], [2, -2], [-2, -2]
];

interface UseRendererOptions {
    canvas: Ref<HTMLCanvasElement | null>;
    getGame: () => Game | null;
    getDebugGrid: () => boolean;
    getShowTerritoryBorders: () => boolean;
    onTileClick: (tile: { x: number; y: number }) => void;
}

export function useRenderer({ canvas, getGame, getDebugGrid, getShowTerritoryBorders, onTileClick }: UseRendererOptions) {
    let renderer: Renderer | null = null;
    let tilePicker: TilePicker | null = null;
    let entityRenderer: EntityRenderer | null = null;
    let landscapeRenderer: LandscapeRenderer | null = null;
    let dragStart: { x: number; y: number } | null = null;
    let isDragging = false;

    function initRenderer() {
        const game = getGame();
        if (game == null || renderer == null) return;

        // Clear old renderers before adding new ones (important for game reloads)
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
            game.fileManager
        );
        renderer.add(entityRenderer);

        void renderer.init().then(() => {
            debugStats.state.rendererReady = true;
        });

        debugStats.state.gameLoaded = true;

        const landTile = game.findLandTile();
        if (landTile) {
            renderer.viewPoint.setPosition(landTile.x, landTile.y);
        }

        // Expose viewPoint for e2e tests (Vue internals are stripped in prod)
        (window as any).__settlers_viewpoint__ = renderer.viewPoint;
        // Expose landscape renderer for debug panel river controls
        (window as any).__settlers_landscape__ = landscapeRenderer;

        // Set up terrain modification callback for building construction
        game.gameLoop.setTerrainModifiedCallback(() => {
            landscapeRenderer?.markTerrainDirty();
        });

        const r = renderer;
        game.gameLoop.setRenderCallback((alpha: number, deltaSec: number) => {
            const g = getGame();
            if (entityRenderer && g) {
                entityRenderer.entities = g.state.entities;
                entityRenderer.selectedEntityId = g.state.selectedEntityId;
                entityRenderer.selectedEntityIds = g.state.selectedEntityIds;
                entityRenderer.unitStates = g.state.unitStates;
                entityRenderer.buildingStates = g.state.buildingStates;
                entityRenderer.territoryMap = getShowTerritoryBorders() ? g.territory : null;
                entityRenderer.territoryVersion = g.territoryVersion;
                entityRenderer.renderAlpha = alpha;
            }
            if (landscapeRenderer) {
                landscapeRenderer.debugGrid = getDebugGrid();
            }
            // Feed game + camera info to debug stats
            if (g) {
                debugStats.updateFromGame(g);
            }
            debugStats.state.cameraX = Math.round(r.viewPoint.x * 10) / 10;
            debugStats.state.cameraY = Math.round(r.viewPoint.y * 10) / 10;
            debugStats.state.zoom = Math.round(r.viewPoint.zoomValue * 100) / 100;
            // Sync zoom/pan speed from debug panel (source of truth) to viewPoint
            r.viewPoint.zoomSpeed = debugStats.state.zoomSpeed;
            r.viewPoint.panSpeed = debugStats.state.panSpeed;
            debugStats.state.canvasWidth = r.canvas.width;
            debugStats.state.canvasHeight = r.canvas.height;
            r.viewPoint.update(deltaSec);
            r.drawOnce();
        });
        game.start();
    }

    const handleMouseDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        dragStart = { x: e.offsetX, y: e.offsetY };
        isDragging = false;
    };

    const handleMouseUp = (e: PointerEvent) => {
        const game = getGame();
        if (e.button !== 0 || !dragStart) return;

        const dx = e.offsetX - dragStart.x;
        const dy = e.offsetY - dragStart.y;
        const wasDrag = Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;

        if (wasDrag && game?.mode === 'select') {
            handleDragSelect(dragStart.x, dragStart.y, e.offsetX, e.offsetY);
        } else {
            handleClick(e);
        }

        dragStart = null;
        isDragging = false;
    };

    function handleDragSelect(x1: number, y1: number, x2: number, y2: number): void {
        const game = getGame();
        if (!game || !tilePicker || !renderer) return;

        const tile1 = tilePicker.screenToTile(x1, y1, renderer.viewPoint, game.mapSize, game.groundHeight);
        const tile2 = tilePicker.screenToTile(x2, y2, renderer.viewPoint, game.mapSize, game.groundHeight);
        if (!tile1 || !tile2) return;

        game.execute({
            type: 'select_area',
            x1: tile1.x, y1: tile1.y,
            x2: tile2.x, y2: tile2.y
        });
    }

    const handleClick = (e: PointerEvent) => {
        const game = getGame();
        if (!game || !tilePicker || !renderer) return;

        const tile = tilePicker.screenToTile(e.offsetX, e.offsetY, renderer.viewPoint, game.mapSize, game.groundHeight);
        if (!tile) return;

        onTileClick(tile);

        if (game.mode === 'place_building') {
            game.execute({
                type: 'place_building',
                buildingType: game.placeBuildingType as BuildingType,
                x: tile.x, y: tile.y,
                player: game.currentPlayer
            });
        } else if (game.mode === 'select') {
            const entity = game.state.getEntityAt(tile.x, tile.y);
            game.execute({ type: 'select', entityId: entity ? entity.id : null });
        }
    };

    const handleRightClick = (e: MouseEvent) => {
        e.preventDefault();
        const game = getGame();
        if (!game || !tilePicker || !renderer) return;

        const tile = tilePicker.screenToTile(e.offsetX, e.offsetY, renderer.viewPoint, game.mapSize, game.groundHeight);
        if (!tile) return;

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
                targetX: tile.x + offset[0],
                targetY: tile.y + offset[1]
            });
        }
    };

    const handleMouseMove = (e: PointerEvent) => {
        const game = getGame();
        if (!game || !tilePicker || !renderer || !entityRenderer) return;

        if (dragStart) {
            const dx = e.offsetX - dragStart.x;
            const dy = e.offsetY - dragStart.y;
            if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                isDragging = true;
            }
        }

        // Always resolve hovered tile for debug stats
        const tile = tilePicker.screenToTile(e.offsetX, e.offsetY, renderer.viewPoint, game.mapSize, game.groundHeight);
        if (tile) {
            debugStats.state.hasTile = true;
            debugStats.state.tileX = tile.x;
            debugStats.state.tileY = tile.y;
            const idx = game.mapSize.toIndex(tile.x, tile.y);
            debugStats.state.tileGroundType = game.groundType[idx];
            debugStats.state.tileGroundHeight = game.groundHeight[idx];
        } else {
            debugStats.state.hasTile = false;
        }

        if (game.mode !== 'place_building') {
            entityRenderer.previewTile = null;
            entityRenderer.previewBuildingType = null;
            return;
        }

        if (!tile) {
            entityRenderer.previewTile = null;
            entityRenderer.previewBuildingType = null;
            return;
        }

        entityRenderer.previewTile = tile;
        entityRenderer.previewBuildingType = game.placeBuildingType as BuildingType ?? null;
        const hasBuildings = game.state.entities.some(
            ent => ent.type === EntityType.Building && ent.player === game.currentPlayer
        );
        entityRenderer.previewValid = canPlaceBuildingWithTerritory(
            game.groundType, game.groundHeight, game.mapSize,
            game.state.tileOccupancy, game.territory,
            tile.x, tile.y, game.currentPlayer, hasBuildings
        );
    };

    onMounted(() => {
        const cavEl = canvas.value!;
        renderer = new Renderer(cavEl);
        tilePicker = new TilePicker(cavEl);

        initRenderer();

        cavEl.addEventListener('pointerdown', handleMouseDown);
        cavEl.addEventListener('pointerup', handleMouseUp);
        cavEl.addEventListener('contextmenu', handleRightClick);
        cavEl.addEventListener('pointermove', handleMouseMove);
    });

    watch(getGame, () => {
        initRenderer();
    });

    onUnmounted(() => {
        const game = getGame();
        if (game) game.stop();

        if (renderer) {
            const cavEl = renderer.canvas;
            cavEl.removeEventListener('pointerdown', handleMouseDown);
            cavEl.removeEventListener('pointerup', handleMouseUp);
            cavEl.removeEventListener('contextmenu', handleRightClick);
            cavEl.removeEventListener('pointermove', handleMouseMove);
            renderer.destroy();
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

    return {
        getRenderer: () => renderer,
        setRace,
        getRace,
    };
}

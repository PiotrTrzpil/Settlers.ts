/**
 * Frame update and render callbacks — connects game state to the renderer each frame.
 */

import type { Ref } from 'vue';
import type { Game } from '@/game/game';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import type { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import type { Renderer, FrameRenderTiming } from '@/game/renderer/renderer';
import { InputManager, BuildingAdjustMode } from '@/game/input';
import type { SelectionBox } from '@/game/input/render-state';
import {
    createRenderContext,
    type ServiceAreaRenderData,
    type TerritoryDotRenderData,
    type StackGhostRenderData,
} from '@/game/renderer/render-context';
import { EntityType } from '@/game/entity';
import { getBuildingVisualState } from '@/game/features/building-construction';
import type { LayerVisibility } from '@/game/renderer/layer-visibility';
import type { IViewPoint } from '@/game/renderer/i-view-point';
import { WorkAreaAdjustHandler } from '@/game/features/building-adjust';
import { computeWorkAreaBoundaryDots } from '@/game/features/work-areas/work-area-boundary';
import type { BuildingType } from '@/game/entity';
import { debugStats } from '@/game/debug-stats';
import { resolveBuildingOverlays } from './overlay-resolution';
import { updatePlacementModeState, clearPlacementModeState } from './placement-state';

/** Context object for render callback — avoids excessive callback parameters */
export interface CallbackContext {
    game: Game | null;
    entityRenderer: EntityRenderer | null;
    indicatorRenderer: BuildingIndicatorRenderer | null;
    landscapeRenderer: LandscapeRenderer | null;
    inputManager: InputManager | null;
    debugGrid: boolean;
    darkLandDilation: boolean;
    layerVisibility: LayerVisibility;
}

/** Update entity renderer state from game using RenderContext interface */
function syncEntityRendererState(
    er: EntityRenderer,
    g: Game,
    ctx: CallbackContext,
    alpha: number,
    viewPoint: IViewPoint
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

    // Collect work area visualization (dots for gameplay mode, circles for debug mode)
    // Isolated: getRadius() throws if BuildingInfo is missing, which must not kill the whole frame.
    let workAreaVis: { circles: readonly ServiceAreaRenderData[]; dots: readonly TerritoryDotRenderData[] };
    try {
        workAreaVis = collectWorkAreaVisualization(ctx.inputManager, g);
    } catch (e) {
        console.error('[frame-callbacks] collectWorkAreaVisualization failed:', e);
        workAreaVis = EMPTY_WORK_AREA_VIS;
    }

    // Stack positions now come from XML data; no ghost rendering is needed.
    const stackGhosts: readonly StackGhostRenderData[] = [];

    // Feature-specific computation happens here (glue layer), not in the renderer.
    // The renderer receives pre-computed BuildingRenderState via the context.
    const bsm = g.services.buildingStateManager;
    const visualService = g.services.visualService;

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
        .buildingOverlaysGetter(entityId => resolveBuildingOverlays(entityId, g, er))
        .visualStateGetter(entityId => visualService.getState(entityId))
        .directionTransitionGetter(entityId => visualService.getDirectionTransition(entityId))
        .selection({
            primaryId: g.state.selection.selectedEntityId,
            ids: g.state.selection.selectedEntityIds,
        })
        .selectedServiceAreas(serviceAreas)
        .territoryDots(territoryDots)
        .workAreaCircles(workAreaVis.circles)
        .workAreaDots(workAreaVis.dots)
        .stackGhosts(stackGhosts)
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

/** Empty result for when no work area visualization is needed */
const EMPTY_WORK_AREA_VIS = { circles: [] as ServiceAreaRenderData[], dots: [] as TerritoryDotRenderData[] };

/**
 * Collect work area visualization data.
 *
 * Priority:
 *  1. Active work-area adjustment (shows live-dragged center position).
 *  2. Selected building that has a work area (always visible, like territory).
 */
function collectWorkAreaVisualization(
    inputManager: InputManager | null,
    game: Game
): { circles: readonly ServiceAreaRenderData[]; dots: readonly TerritoryDotRenderData[] } {
    // --- Priority 1: active adjustment (live position while dragging) ---
    if (inputManager) {
        const mode = inputManager.getMode('building-adjust');
        if (mode instanceof BuildingAdjustMode) {
            const active = mode.getActiveAdjustment();
            if (active?.item.category === 'work-area' && active.handler instanceof WorkAreaAdjustHandler) {
                const waHandler = active.handler;
                const center = waHandler.getAbsoluteCenter(
                    active.buildingId,
                    active.buildingX,
                    active.buildingY,
                    active.buildingType,
                    active.race
                );
                const entity = game.state.getEntity(active.buildingId);
                const player = entity ? entity.player : 0;
                const radius = waHandler.getRadius(active.buildingType, active.race);
                const dots = computeWorkAreaBoundaryDots(
                    center.x,
                    center.y,
                    radius,
                    player,
                    game.terrain.width,
                    game.terrain.height
                );
                return { circles: [], dots };
            }
        }
    }

    // --- Priority 2: selected building (always visible when a work-area building is selected) ---
    const selectedId = game.state.selection.selectedEntityId;
    if (selectedId === null) return EMPTY_WORK_AREA_VIS;

    const entity = game.state.getEntity(selectedId);
    if (!entity || entity.type !== EntityType.Building) return EMPTY_WORK_AREA_VIS;

    const buildingType = entity.subType as BuildingType;
    const store = game.services.workAreaStore;
    if (!store.hasWorkArea(buildingType)) return EMPTY_WORK_AREA_VIS;

    const center = store.getAbsoluteCenter(selectedId, entity.x, entity.y, buildingType, entity.race);
    const radius = store.getRadius(buildingType, entity.race);
    const dots = computeWorkAreaBoundaryDots(
        center.x,
        center.y,
        radius,
        entity.player,
        game.terrain.width,
        game.terrain.height
    );
    return { circles: [], dots };
}

/**
 * Create the per-frame update callback for non-rendering work.
 * Called by GameLoop BEFORE the render callback each visible frame.
 * Handles: input processing, sound, debug stats.
 */
export function createUpdateCallback(
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
export function createRenderCallback(
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
            if (inPlacementMode) {
                updatePlacementModeState(er, renderState);
            } else {
                clearPlacementModeState(er);
            }

            // Update building indicator renderer state
            ctx.indicatorRenderer?.setState(inPlacementMode, g.state.entities, er.placementPreview);

            er.tileHighlights = renderState?.highlights ?? [];
        }

        if (landscapeRenderer) {
            landscapeRenderer.debugGrid = ctx.debugGrid;
            landscapeRenderer.darkLandDilation = ctx.darkLandDilation;
        }

        // GPU draw
        renderer.drawOnce();

        return renderer.getLastRenderTiming();
    };
}

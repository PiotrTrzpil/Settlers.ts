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
    type RenderContextBuilder,
    type CircleRenderData,
    type TerritoryDotRenderData,
} from '@/game/renderer/render-context';
import { getBuildingVisualState } from '@/game/features/building-construction';
import type { LayerVisibility } from '@/game/renderer/layer-visibility';
import type { IViewPoint } from '@/game/renderer/i-view-point';
import type { ValidPositionGrid } from '@/game/systems/placement/valid-position-grid';
import { MAX_SLOPE_DIFF } from '@/game/systems/placement';
import { WorkAreaAdjustHandler } from '@/game/input/building-adjust';
import { computeWorkAreaColoredRings } from '@/game/features/work-areas/work-area-boundary';
import { debugStats } from '@/game/debug/debug-stats';
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
    placementGrid: ValidPositionGrid | null;
}

/** Wire core entity data into the render context */
function applyEntityData(b: RenderContextBuilder, g: Game): void {
    b.entities(g.state.entities).unitStates(g.state.unitStates).pileStates(g.state.piles.states).selection({
        primaryId: g.state.selection.selectedEntityId,
        ids: g.state.selection.selectedEntityIds,
    });
}

/** Wire building construction visuals and overlays */
function applyBuildingVisuals(b: RenderContextBuilder, g: Game, er: EntityRenderer): void {
    const csm = g.services.constructionSiteManager;
    b.buildingRenderStateGetter(entityId => {
        const site = csm.getSite(entityId);
        const vs = getBuildingVisualState(site);
        return {
            useConstructionSprite: vs.useConstructionSprite,
            verticalProgress: vs.verticalProgress,
        };
    }).buildingOverlaysGetter(entityId => resolveBuildingOverlays(entityId, g, er));
}

/** Wire animation state and combat health ratio */
function applyAnimationAndCombat(b: RenderContextBuilder, g: Game): void {
    const visualService = g.services.visualService;
    b.visualStateGetter(visualService.getState.bind(visualService))
        .directionTransitionGetter(visualService.getDirectionTransition.bind(visualService))
        .healthRatioGetter(entityId => {
            const cs = g.services.combatSystem.getState(entityId);
            if (!cs) {
                return null;
            }
            return cs.maxHealth > 0 ? cs.health / cs.maxHealth : 1;
        });
}

/** Compute and wire territory, work area, and stack ghost overlays */
function applyMapOverlays(b: RenderContextBuilder, g: Game, ctx: CallbackContext): void {
    const getTerritoryDots = g.services
        .getRenderDataRegistry()
        .get<readonly TerritoryDotRenderData[]>('territory', 'territoryDots');
    const territoryDots: readonly TerritoryDotRenderData[] =
        ctx.layerVisibility.showTerritory && getTerritoryDots ? getTerritoryDots() : [];

    // Isolated: getRadius() throws if BuildingInfo is missing, which must not kill the whole frame.
    let workAreaVis: { circles: readonly CircleRenderData[]; dots: readonly TerritoryDotRenderData[] };
    try {
        workAreaVis = collectWorkAreaVisualization(ctx.inputManager, g);
    } catch (e) {
        console.error('[frame-callbacks] collectWorkAreaVisualization failed:', e);
        workAreaVis = EMPTY_WORK_AREA_VIS;
    }

    b.territoryDots(territoryDots).workAreaCircles(workAreaVis.circles).workAreaDots(workAreaVis.dots).stackGhosts([]);
}

/** Wire terrain, camera, and rendering parameters */
function applyRenderEnvironment(
    b: RenderContextBuilder,
    g: Game,
    ctx: CallbackContext,
    alpha: number,
    viewPoint: IViewPoint
): void {
    b.alpha(alpha)
        .layerVisibility(ctx.layerVisibility)
        .settings({
            showBuildingFootprint: ctx.layerVisibility.showBuildingFootprint,
            disablePlayerTinting: g.settings.state.disablePlayerTinting,
            antialias: g.settings.state.antialias,
        })
        .groundHeight(g.terrain.groundHeight)
        .groundType(g.terrain.groundType)
        .mapSize(g.terrain.width, g.terrain.height)
        .viewPoint(viewPoint);
}

/** Update entity renderer state from game using RenderContext interface */
function syncEntityRendererState(
    er: EntityRenderer,
    g: Game,
    ctx: CallbackContext,
    alpha: number,
    viewPoint: IViewPoint
): void {
    const b = createRenderContext();
    applyEntityData(b, g);
    applyBuildingVisuals(b, g, er);
    applyAnimationAndCombat(b, g);
    applyMapOverlays(b, g, ctx);
    applyRenderEnvironment(b, g, ctx, alpha, viewPoint);
    er.setContext(b.build());
}

/** Empty result for when no work area visualization is needed */
const EMPTY_WORK_AREA_VIS = { circles: [] as CircleRenderData[], dots: [] as TerritoryDotRenderData[] };

/**
 * Collect work area visualization data.
 *
 * Only shown when the user is actively in "Set Work Area" mode (building-adjust).
 * Renders 3 concentric rings: inner (green), mid (yellow), outer (red).
 */
function collectWorkAreaVisualization(
    inputManager: InputManager | null,
    game: Game
): { circles: readonly CircleRenderData[]; dots: readonly TerritoryDotRenderData[] } {
    if (!inputManager) {
        return EMPTY_WORK_AREA_VIS;
    }

    const mode = inputManager.getMode('building-adjust');
    if (!(mode instanceof BuildingAdjustMode)) {
        return EMPTY_WORK_AREA_VIS;
    }

    const active = mode.getActiveAdjustment();
    if (!active || active.item.category !== 'work-area' || !(active.handler instanceof WorkAreaAdjustHandler)) {
        return EMPTY_WORK_AREA_VIS;
    }

    const waHandler = active.handler;
    const center = waHandler.getAbsoluteCenter(
        active.buildingId,
        active.buildingX,
        active.buildingY,
        active.buildingType,
        active.race
    );
    const radius = waHandler.getRadius(active.buildingType, active.race);
    const dots = computeWorkAreaColoredRings(center.x, center.y, radius, game.terrain.width, game.terrain.height);
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

        // Advance grid computation (spiral outward from camera center)
        if (ctx.placementGrid && !ctx.placementGrid.isComplete) {
            ctx.placementGrid.computeChunk(1000);
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
            const inPlacementMode = mode === 'place_building' || mode === 'place_pile' || mode === 'place_unit';
            if (inPlacementMode) {
                updatePlacementModeState(er, renderState);
            } else {
                clearPlacementModeState(er);
            }

            // Update building indicator renderer state
            ctx.indicatorRenderer?.setState(
                inPlacementMode,
                ctx.placementGrid,
                er.placementPreview?.tile ?? null,
                MAX_SLOPE_DIFF
            );

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

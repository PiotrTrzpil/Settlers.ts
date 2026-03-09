/**
 * GroundOverlayPass — draws building footprints and work area circles.
 *
 * Work area circles render as ground overlays (below entities).
 * Building footprints render on top of entity sprites via drawFootprints().
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, GroundOverlayContext } from './types';
import { SelectionOverlayRenderer } from '../selection-overlay-renderer';
import { WORK_AREA_CIRCLE_COLOR } from '../entity-renderer-constants';

export class GroundOverlayPass implements IRenderPass {
    private ctx!: GroundOverlayContext;
    private readonly overlay: SelectionOverlayRenderer;

    constructor(overlay: SelectionOverlayRenderer) {
        this.overlay = overlay;
    }

    public prepare(ctx: GroundOverlayContext): void {
        this.ctx = ctx;
    }

    /** Draw ground-level overlays (work area circles). */
    public draw(gl: WebGL2RenderingContext, _projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        const hasWorkAreas = ctx.workAreaCircles.length > 0;
        if (!hasWorkAreas) return;

        this.setupAttributes(gl, viewPoint);

        this.overlay.drawCircleOverlays(
            gl,
            ctx.dynamicBuffer,
            ctx.workAreaCircles,
            ctx.aEntityPos,
            ctx.aColor,
            this.selCtx!,
            WORK_AREA_CIRCLE_COLOR
        );
    }

    /** Draw building footprint overlays (called after entity sprites for on-top rendering). */
    public drawFootprints(gl: WebGL2RenderingContext, _projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (!ctx.renderSettings.showBuildingFootprint) return;

        this.setupAttributes(gl, viewPoint);

        this.overlay.drawBuildingFootprints(
            gl,
            ctx.dynamicBuffer,
            ctx.sortedEntities,
            ctx.aPosition,
            ctx.aEntityPos,
            ctx.aColor,
            this.selCtx!
        );
    }

    private selCtx: { mapSize: GroundOverlayContext['mapSize']; groundHeight: Uint8Array; viewPoint: IViewPoint; unitStates: GroundOverlayContext['unitStates'] } | null = null;

    private setupAttributes(gl: WebGL2RenderingContext, viewPoint: IViewPoint): void {
        const { ctx } = this;
        gl.bindBuffer(gl.ARRAY_BUFFER, ctx.dynamicBuffer);
        gl.enableVertexAttribArray(ctx.aPosition);
        gl.vertexAttribPointer(ctx.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(ctx.aEntityPos);
        gl.disableVertexAttribArray(ctx.aColor);

        this.selCtx = {
            mapSize: ctx.mapSize,
            groundHeight: ctx.groundHeight,
            viewPoint,
            unitStates: ctx.unitStates,
        };
    }
}

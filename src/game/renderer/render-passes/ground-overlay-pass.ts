/**
 * GroundOverlayPass — draws building footprints, service area circles, and work area circles.
 *
 * Only runs when at least one of these features is active.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, PassContext } from './types';
import { SelectionOverlayRenderer } from '../selection-overlay-renderer';
import { WORK_AREA_CIRCLE_COLOR } from '../entity-renderer-constants';

export class GroundOverlayPass implements IRenderPass {
    private ctx!: PassContext;
    private readonly overlay: SelectionOverlayRenderer;

    constructor(overlay: SelectionOverlayRenderer) {
        this.overlay = overlay;
    }

    public prepare(ctx: PassContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        const hasFootprints = ctx.renderSettings.showBuildingFootprint;
        const hasServiceAreas = ctx.selectedServiceAreas.length > 0;
        const hasWorkAreas = ctx.workAreaCircles.length > 0;
        if (!hasFootprints && !hasServiceAreas && !hasWorkAreas) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, ctx.dynamicBuffer);
        gl.enableVertexAttribArray(ctx.aPosition);
        gl.vertexAttribPointer(ctx.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(ctx.aEntityPos);
        gl.disableVertexAttribArray(ctx.aColor);

        const selCtx = {
            mapSize: ctx.mapSize,
            groundHeight: ctx.groundHeight,
            viewPoint,
            unitStates: ctx.unitStates,
        };

        if (hasFootprints) {
            this.overlay.drawBuildingFootprints(
                gl,
                ctx.dynamicBuffer,
                ctx.sortedEntities,
                ctx.aPosition,
                ctx.aEntityPos,
                ctx.aColor,
                selCtx
            );
        }
        if (hasServiceAreas) {
            this.overlay.drawServiceAreaCircles(
                gl,
                ctx.dynamicBuffer,
                ctx.selectedServiceAreas,
                ctx.aEntityPos,
                ctx.aColor,
                selCtx
            );
        }
        if (hasWorkAreas) {
            this.overlay.drawServiceAreaCircles(
                gl,
                ctx.dynamicBuffer,
                ctx.workAreaCircles,
                ctx.aEntityPos,
                ctx.aColor,
                selCtx,
                WORK_AREA_CIRCLE_COLOR
            );
        }
    }
}

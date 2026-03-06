/**
 * SelectionPass — draws selection frames, selection dots, and tile highlights.
 *
 * Uses the color shader + SelectionOverlayRenderer.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, SelectionContext } from './types';
import { SelectionOverlayRenderer } from '../selection-overlay-renderer';

export class SelectionPass implements IRenderPass {
    private ctx!: SelectionContext;
    private readonly overlay: SelectionOverlayRenderer;

    constructor(overlay: SelectionOverlayRenderer) {
        this.overlay = overlay;
    }

    public prepare(ctx: SelectionContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, _projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        const buf = ctx.dynamicBuffer;
        const selCtx = {
            mapSize: ctx.mapSize,
            groundHeight: ctx.groundHeight,
            viewPoint,
            unitStates: ctx.unitStates,
        };

        this.overlay.drawSelectionFrames(
            gl,
            buf,
            ctx.sortedEntities,
            ctx.selectedEntityIds,
            ctx.aEntityPos,
            ctx.aColor,
            selCtx
        );
        this.overlay.drawSelectionDots(
            gl,
            buf,
            ctx.sortedEntities,
            ctx.selectedEntityIds,
            ctx.aEntityPos,
            ctx.aColor,
            selCtx
        );

        if (ctx.tileHighlights.length > 0) {
            this.overlay.drawTileHighlights(gl, buf, ctx.tileHighlights, ctx.aEntityPos, ctx.aColor, selCtx);
        }
    }
}

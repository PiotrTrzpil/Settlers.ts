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
        const s = this.overlay.begin(gl, ctx.dynamicBuffer, ctx.aEntityPos, ctx.aColor, {
            mapSize: ctx.mapSize,
            groundHeight: ctx.groundHeight,
            viewPoint,
            unitStates: ctx.unitStates,
        });

        s.drawSelectionFrames(ctx.sortedEntities, ctx.selectedEntityIds);
        s.drawSelectionDots(ctx.sortedEntities, ctx.selectedEntityIds);

        if (ctx.tileHighlights.length > 0) {
            s.drawTileHighlights(ctx.tileHighlights);
        }
    }
}

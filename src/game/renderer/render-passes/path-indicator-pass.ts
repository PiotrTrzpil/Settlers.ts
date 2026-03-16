/**
 * PathIndicatorPass — draws path dots for selected units.
 *
 * Depends on: color shader (aEntityPos, aColor), SelectionOverlayRenderer.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, PathIndicatorContext } from './types';
import { SelectionOverlayRenderer } from '../selection-overlay-renderer';

export class PathIndicatorPass implements IRenderPass {
    private ctx!: PathIndicatorContext;
    private readonly overlay: SelectionOverlayRenderer;

    constructor(overlay: SelectionOverlayRenderer) {
        this.overlay = overlay;
    }

    public prepare(ctx: PathIndicatorContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, _projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.ctx.layerVisibility.showPathfinding) {
            return;
        }

        this.overlay
            .begin(gl, this.ctx.dynamicBuffer, this.ctx.aEntityPos, this.ctx.aColor, {
                mapSize: this.ctx.mapSize,
                groundHeight: this.ctx.groundHeight,
                viewPoint,
                unitStates: this.ctx.unitStates,
            })
            .drawSelectedUnitPath(this.ctx.selectedEntityIds);
    }
}

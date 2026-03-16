/**
 * Shared session state for overlay rendering.
 * Captured once per frame by SelectionOverlayRenderer.begin(),
 * then passed to sub-renderers so they don't need individual GL params.
 */

import type { SelectionRenderContext } from '../selection-overlay-renderer';

export interface OverlaySession {
    readonly gl: WebGL2RenderingContext;
    readonly buffer: WebGLBuffer;
    readonly aEntityPos: number;
    readonly aColor: number;
    readonly ctx: SelectionRenderContext;
}

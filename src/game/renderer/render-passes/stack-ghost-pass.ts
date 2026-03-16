/**
 * StackGhostPass — renders semi-transparent resource sprite ghosts during stack-adjust mode.
 *
 * Previews where input/output resources will appear after confirmation.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, StackGhostContext } from './types';
import { TilePicker } from '@/game/input/tile-picker';
import { scaleSprite } from '../entity-renderer-constants';
import type { Tint } from '../tint-utils';

const TINT_GHOST: Tint = [1, 1, 1, 0.5];

export class StackGhostPass implements IRenderPass {
    private ctx!: StackGhostContext;

    /** Draw calls emitted by this pass (updated each frame). */
    public lastDrawCalls = 0;

    public prepare(ctx: StackGhostContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (ctx.stackGhosts.length === 0) {
            return;
        }
        if (!ctx.spriteManager?.hasSprites || !ctx.spriteBatchRenderer.isInitialized) {
            return;
        }

        ctx.spriteBatchRenderer.beginWithAtlas(gl, projection, ctx.spriteManager, ctx.renderSettings.antialias);

        for (const ghost of ctx.stackGhosts) {
            const worldPos = TilePicker.tileToWorld(
                ghost.x,
                ghost.y,
                ctx.groundHeight,
                ctx.mapSize,
                viewPoint.x,
                viewPoint.y
            );

            for (let v = 0; v < ghost.count; v++) {
                const rawSprite = ctx.spriteResolver.getPreviewSprite('pile', ghost.materialType, v);
                if (!rawSprite) {
                    continue;
                }

                const sprite = scaleSprite(rawSprite);
                ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, sprite, 0, TINT_GHOST);
            }
        }

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);
    }
}

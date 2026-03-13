/**
 * StackGhostPass — renders semi-transparent resource sprite ghosts during stack-adjust mode.
 *
 * Previews where input/output resources will appear after confirmation.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, StackGhostContext } from './types';
import { TilePicker } from '@/game/input/tile-picker';
import { PALETTE_TEXTURE_WIDTH } from '../palette-texture';
import { scaleSprite } from '../entity-renderer-constants';

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

        ctx.spriteManager.spriteAtlas!.bindForRendering(gl);
        ctx.spriteManager.paletteManager.bind(gl);

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = ctx.spriteManager.paletteManager.textureRowsPerPlayer;
        ctx.spriteBatchRenderer.beginSpriteBatch(
            gl,
            projection,
            paletteWidth,
            rowsPerPlayer,
            ctx.renderSettings.antialias
        );

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
                ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, sprite, 0, 1, 1, 1, 0.5);
            }
        }

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);
    }
}

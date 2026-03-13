/**
 * TerritoryDotPass — renders territory boundary dots and work area dots as sprites.
 *
 * Uses the sprite batch renderer with the territory dot sprite from SpriteRenderManager.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, TerritoryDotContext } from './types';
import type { TerritoryDotRenderData } from '../render-context';
import { TilePicker } from '@/game/input/tile-picker';
import { PALETTE_TEXTURE_WIDTH } from '../palette-texture';
import { scaleSprite } from '../entity-renderer-constants';

export class TerritoryDotPass implements IRenderPass {
    private ctx!: TerritoryDotContext;

    /** Draw calls emitted by this pass (updated each frame). */
    public lastDrawCalls = 0;

    /** One-shot diagnostic flag — warns once per lifetime when sprites are missing. */
    private warnedMissingSprite = false;

    public prepare(ctx: TerritoryDotContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (ctx.territoryDots.length === 0 && ctx.workAreaDots.length === 0) {
            return;
        }
        if (!ctx.spriteManager?.hasSprites || !ctx.spriteBatchRenderer.isInitialized) {
            return;
        }
        if (!ctx.spriteManager.hasTerritoryDotSprites()) {
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

        this.renderDots(gl, ctx.territoryDots, 2.25, viewPoint);
        this.renderDots(gl, ctx.workAreaDots, 1.5, viewPoint);

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);
    }

    private renderDots(
        gl: WebGL2RenderingContext,
        dots: readonly TerritoryDotRenderData[],
        scale: number,
        viewPoint: IViewPoint
    ): void {
        const { ctx } = this;
        for (const dot of dots) {
            const sprite = ctx.spriteManager!.getTerritoryDot(dot.player);
            if (!sprite) {
                if (!this.warnedMissingSprite) {
                    console.warn(
                        `[TerritoryDotPass] getTerritoryDot(${dot.player}) returned null — sprite not loaded for this player index`
                    );
                    this.warnedMissingSprite = true;
                }
                continue;
            }
            const worldPos = TilePicker.tileToWorld(
                dot.x,
                dot.y,
                ctx.groundHeight,
                ctx.mapSize,
                viewPoint.x,
                viewPoint.y
            );
            const scaled = scaleSprite(sprite, scale);
            ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, scaled, 0, 1, 1, 1, 1);
        }
    }
}

/**
 * TerritoryDotPass — renders territory boundary dots and work area dots as sprites.
 *
 * Uses the sprite batch renderer with the territory dot sprite from SpriteRenderManager.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, PassContext } from './types';
import { TilePicker } from '@/game/input/tile-picker';
import { PALETTE_TEXTURE_WIDTH } from '../palette-texture';
import { scaleSprite } from '../entity-renderer-constants';

export class TerritoryDotPass implements IRenderPass {
    private ctx!: PassContext;

    /** Draw calls emitted by this pass (updated each frame). */
    public lastDrawCalls = 0;

    /** One-shot diagnostic flag — warns once per lifetime when sprites are missing. */
    private warnedMissingSprite = false;

    public prepare(ctx: PassContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (ctx.territoryDots.length === 0 && ctx.workAreaDots.length === 0) return;
        if (!ctx.spriteManager?.hasSprites || !ctx.spriteBatchRenderer.isInitialized) return;

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

        for (const dot of ctx.territoryDots) {
            const sprite = ctx.spriteManager.getTerritoryDot(dot.player);
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
            const scaled = scaleSprite(sprite, 2.25);
            ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, scaled, 0, 1, 1, 1, 1);
        }

        for (const dot of ctx.workAreaDots) {
            const sprite = ctx.spriteManager.getTerritoryDot(dot.player);
            if (!sprite) {
                if (!this.warnedMissingSprite) {
                    console.warn(`[TerritoryDotPass] work area dot: getTerritoryDot(${dot.player}) returned null`);
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
            const scaled = scaleSprite(sprite, 1.5);
            ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, scaled, 0, 1, 1, 1, 1);
        }

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);
    }
}

/**
 * TerritoryDotPass — renders territory boundary dots and work area dots as sprites.
 *
 * Uses the sprite batch renderer with the territory dot sprite from SpriteRenderManager.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, TerritoryDotContext } from './types';
import type { TerritoryDotRenderData } from '../render-context';
import { tileToWorld, heightToWorld } from '@/game/systems/coordinate-system';
import { scaleSprite } from '../entity-renderer-constants';
import { TINT_NEUTRAL } from '../tint-utils';

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
        if (!ctx.spriteManager.registry.hasTerritoryDotSprites()) {
            return;
        }

        ctx.spriteBatchRenderer.beginWithAtlas(gl, projection, ctx.spriteManager, ctx.renderSettings.antialias);

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
        const { groundHeight, mapSize } = ctx;
        for (const dot of dots) {
            const sprite = ctx.spriteManager!.registry.getTerritoryDot(dot.player);
            if (!sprite) {
                if (!this.warnedMissingSprite) {
                    console.warn(
                        `[TerritoryDotPass] getTerritoryDot(${dot.player}) returned null — sprite not loaded for this player index`
                    );
                    this.warnedMissingSprite = true;
                }
                continue;
            }
            // Use integer coords for height lookup, apply fractional offset to world position
            const idx = mapSize.toIndex(dot.x, dot.y);
            const hWorld = heightToWorld(groundHeight[idx]!);
            // eslint-disable-next-line no-restricted-syntax -- offsetX/offsetY are optional sub-tile position offsets; 0 is the correct default (no offset)
            const tileX = dot.x + (dot.offsetX ?? 0);
            // eslint-disable-next-line no-restricted-syntax -- offsetX/offsetY are optional sub-tile position offsets; 0 is the correct default (no offset)
            const tileY = dot.y + (dot.offsetY ?? 0);
            const worldPos = tileToWorld(tileX, tileY, hWorld, viewPoint.x, viewPoint.y);
            const scaled = scaleSprite(sprite.staticSprite, scale);
            ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, scaled, 0, TINT_NEUTRAL);
        }
    }
}

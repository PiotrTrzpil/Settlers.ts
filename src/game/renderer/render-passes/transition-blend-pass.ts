/**
 * TransitionBlendPass — draws units transitioning between movement directions.
 *
 * EntitySpritePass pre-resolves both direction sprites during its loop and
 * queues them here via queueTransition(). This pass only handles scaling,
 * tinting, positioning, and the blend shader draw calls — no sprite resolution.
 */

import type { Entity } from '@/game/entity';
import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, TransitionBlendContext } from './types';
import type { TransitionSpriteData } from '../entity-sprite-resolver';
import { TilePicker } from '@/game/input/tile-picker';
import { PALETTE_TEXTURE_WIDTH } from '../palette-texture';
import { scaleSprite } from '../entity-renderer-constants';
import { TINT_NEUTRAL, TINT_SELECTED } from '../tint-utils';

interface QueuedTransition {
    entity: Entity;
    data: TransitionSpriteData;
}

export class TransitionBlendPass implements IRenderPass {
    private ctx!: TransitionBlendContext;
    private readonly queue: QueuedTransition[] = [];

    public prepare(ctx: TransitionBlendContext): void {
        this.ctx = ctx;
        this.queue.length = 0;
    }

    /** Queue a unit with pre-resolved transition sprites (called by EntitySpritePass). */
    queueTransition(entity: Entity, data: TransitionSpriteData): void {
        this.queue.push({ entity, data });
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (this.queue.length === 0) return;
        if (!ctx.spriteManager) return;

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = ctx.spriteManager.paletteManager.textureRowsPerPlayer;
        ctx.spriteBatchRenderer.beginBlendBatch(gl, projection, paletteWidth, rowsPerPlayer);

        for (const { entity, data } of this.queue) {
            const scaledOld = scaleSprite(data.oldSprite);
            const scaledNew = scaleSprite(data.newSprite);

            const cachedPos = ctx.frameContext?.getWorldPos(entity);
            const worldPos = cachedPos ?? this.getInterpolatedWorldPos(entity, viewPoint);
            const playerRow = ctx.renderSettings.disablePlayerTinting ? 0 : entity.player + 1;
            const isSelected = ctx.selectedEntityIds.has(entity.id);
            const tint = isSelected ? TINT_SELECTED : TINT_NEUTRAL;

            ctx.spriteBatchRenderer.addBlendSprite(
                gl,
                worldPos.worldX,
                worldPos.worldY,
                scaledOld,
                scaledNew,
                data.blendFactor,
                playerRow,
                tint[0]!,
                tint[1]!,
                tint[2]!,
                tint[3]!
            );
        }

        ctx.spriteBatchRenderer.endBlendBatch(gl);
    }

    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const { ctx } = this;
        const unitState = ctx.unitStates.get(entity.id);
        if (!unitState || (unitState.prevX === entity.x && unitState.prevY === entity.y)) {
            return TilePicker.tileToWorld(entity.x, entity.y, ctx.groundHeight, ctx.mapSize, viewPoint.x, viewPoint.y);
        }
        const prevPos = TilePicker.tileToWorld(
            unitState.prevX,
            unitState.prevY,
            ctx.groundHeight,
            ctx.mapSize,
            viewPoint.x,
            viewPoint.y
        );
        const currPos = TilePicker.tileToWorld(
            entity.x,
            entity.y,
            ctx.groundHeight,
            ctx.mapSize,
            viewPoint.x,
            viewPoint.y
        );
        const t = Math.max(0, Math.min(unitState.moveProgress, 1));
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t,
        };
    }
}

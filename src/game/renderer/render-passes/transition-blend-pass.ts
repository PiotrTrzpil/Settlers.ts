/**
 * TransitionBlendPass — draws units transitioning between movement directions.
 *
 * These units are identified during the EntitySpritePass and rendered here
 * using the blend shader (two sprites cross-faded by directionTransitionProgress).
 */

import type { Entity } from '@/game/entity';
import { UnitType } from '@/game/entity';
import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, PassContext } from './types';
import { TilePicker } from '@/game/input/tile-picker';
import { PALETTE_TEXTURE_WIDTH } from '../palette-texture';
import { scaleSprite } from '../entity-renderer-constants';
import { TINT_NEUTRAL, TINT_SELECTED } from '../tint-utils';

export class TransitionBlendPass implements IRenderPass {
    private ctx!: PassContext;
    /** Units queued by EntitySpritePass each frame */
    public transitioningUnits: Entity[] = [];

    public prepare(ctx: PassContext): void {
        this.ctx = ctx;
        this.transitioningUnits.length = 0;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (this.transitioningUnits.length === 0) return;
        if (!ctx.spriteManager) return;

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = ctx.spriteManager.paletteManager.textureRowsPerPlayer;
        ctx.spriteBatchRenderer.beginBlendBatch(gl, projection, paletteWidth, rowsPerPlayer);

        for (const entity of this.transitioningUnits) {
            const vs = ctx.getVisualState(entity.id);
            const transition = ctx.getDirectionTransition(entity.id);
            if (!vs?.animation || !transition) continue;

            const oldDir = transition.previousDirection;
            const newDir = vs.animation.direction;
            const blendFactor = transition.progress;
            const unitType = entity.subType as UnitType;

            const oldSprite = ctx.spriteResolver.getUnitSpriteForDirection(unitType, vs.animation, oldDir, entity.race);
            const newSprite = ctx.spriteResolver.getUnitSpriteForDirection(unitType, vs.animation, newDir, entity.race);

            if (!oldSprite || !newSprite) continue;

            const scaledOld = scaleSprite(oldSprite);
            const scaledNew = scaleSprite(newSprite);

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
                blendFactor,
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

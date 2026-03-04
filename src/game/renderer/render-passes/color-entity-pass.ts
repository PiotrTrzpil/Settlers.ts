/**
 * ColorEntityPass — draws entities as solid color quads (fallback when sprites are unavailable,
 * or for entities that lack a textured sprite).
 *
 * Also collects debug decoration labels during the pass for HUD rendering.
 */

import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, PassContext } from './types';
import { TilePicker } from '@/game/input/tile-picker';
import { TILE_CENTER_X, TILE_CENTER_Y } from '@/game/systems/coordinate-system';
import { subTypeToRawByte } from '@/resources/map/raw-object-registry';
import {
    BASE_QUAD,
    BUILDING_SCALE,
    UNIT_SCALE,
    PILE_SCALE,
    decoHueToRgb,
    decoTypeToHue,
} from '../entity-renderer-constants';
import { PLAYER_COLORS } from '../tint-utils';

export class ColorEntityPass implements IRenderPass {
    private ctx!: PassContext;
    /** Whether the textured sprite pass already handled buildings/units with sprites. */
    public texturedBuildingsHandled = false;

    private readonly vertexData = new Float32Array(6 * 2);

    public prepare(ctx: PassContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;

        gl.bindBuffer(gl.ARRAY_BUFFER, ctx.dynamicBuffer);
        gl.enableVertexAttribArray(ctx.aPosition);
        gl.vertexAttribPointer(ctx.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(ctx.aEntityPos);
        gl.disableVertexAttribArray(ctx.aColor);

        const canvasW = gl.canvas.width;
        const canvasH = gl.canvas.height;
        ctx.debugDecoLabels.length = 0;

        for (const entity of ctx.sortedEntities) {
            if (this.shouldSkip(entity)) continue;

            const appearance = this.getAppearance(entity);
            const worldPos = this.getEntityWorldPos(entity, viewPoint);

            gl.vertexAttrib2f(ctx.aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(0, 0, appearance.scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(
                ctx.aColor,
                appearance.color[0]!,
                appearance.color[1]!,
                appearance.color[2]!,
                appearance.color[3]!
            );
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            if (appearance.isDecoration) {
                this.collectDecoDebugLabel(entity, worldPos, projection, canvasW, canvasH);
            }
        }
    }

    private shouldSkip(entity: Entity): boolean {
        return this.texturedBuildingsHandled && this.ctx.spriteResolver.hasTexturedSprite(entity);
    }

    private getAppearance(entity: Entity): { color: readonly number[]; scale: number; isDecoration: boolean } {
        const isSelected = this.ctx.selectedEntityIds.has(entity.id);
        const isDecoration = entity.type === EntityType.MapObject;
        if (isSelected)
            return {
                color: [1.0, 1.0, 0.0, 1.0],
                scale: isDecoration ? 0.8 : this.getEntityScale(entity.type),
                isDecoration,
            };
        const baseColor = isDecoration
            ? decoHueToRgb(entity.subType)
            : PLAYER_COLORS[entity.player % PLAYER_COLORS.length]!;
        const scale = isDecoration ? 0.8 : this.getEntityScale(entity.type);
        return { color: baseColor, scale, isDecoration };
    }

    private getEntityScale(entityType: EntityType): number {
        if (entityType === EntityType.Building) return BUILDING_SCALE;
        if (entityType === EntityType.StackedPile) return PILE_SCALE;
        return UNIT_SCALE;
    }

    private collectDecoDebugLabel(
        entity: Entity,
        worldPos: { worldX: number; worldY: number },
        projection: Float32Array,
        canvasW: number,
        canvasH: number
    ): void {
        const clipX = projection[0]! * worldPos.worldX + projection[12]!;
        const clipY = projection[5]! * worldPos.worldY + projection[13]!;
        const rawByte = subTypeToRawByte(entity.subType);
        this.ctx.debugDecoLabels.push({
            screenX: (clipX * 0.5 + 0.5) * canvasW,
            screenY: (-clipY * 0.5 + 0.5) * canvasH,
            type: rawByte,
            hue: decoTypeToHue(entity.subType),
        });
    }

    private getEntityWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const { ctx } = this;
        const cachedPos = ctx.frameContext?.getWorldPos(entity);
        let worldPos: { worldX: number; worldY: number };

        if (cachedPos) {
            worldPos = { worldX: cachedPos.worldX, worldY: cachedPos.worldY };
        } else if (entity.type === EntityType.Unit) {
            worldPos = this.getInterpolatedWorldPos(entity, viewPoint);
        } else {
            worldPos = TilePicker.tileToWorld(
                entity.x,
                entity.y,
                ctx.groundHeight,
                ctx.mapSize,
                viewPoint.x,
                viewPoint.y
            );
        }

        if (entity.type === EntityType.Building) {
            worldPos.worldX -= TILE_CENTER_X;
            worldPos.worldY -= TILE_CENTER_Y * 0.5;
        }

        if (entity.type === EntityType.MapObject) {
            const seed = entity.x * 12.9898 + entity.y * 78.233;
            const offsetX = ((Math.sin(seed) * 43758.5453) % 1) * 0.3 - 0.15;
            const offsetY = ((Math.cos(seed) * 43758.5453) % 1) * 0.3 - 0.15;
            worldPos.worldX += offsetX;
            worldPos.worldY += offsetY;
        }

        return worldPos;
    }

    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const { ctx } = this;
        const unitState = ctx.unitStates.get(entity.id);
        const isStationary = !unitState || (unitState.prevX === entity.x && unitState.prevY === entity.y);

        if (isStationary) {
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

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2]! * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1]! * scale + worldY;
        }
    }
}

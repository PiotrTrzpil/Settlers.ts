/**
 * ColorEntityPass — draws entities as solid color quads (fallback when sprites are unavailable,
 * or for entities that lack a textured sprite).
 *
 * Also collects debug decoration labels during the pass for HUD rendering.
 */

import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, ColorEntityContext } from './types';
import { getRenderEntityWorldPos } from '../world-position';
import {
    fillQuadVertices,
    BUILDING_SCALE,
    UNIT_SCALE,
    PILE_SCALE,
    decoHueToRgb,
    decoTypeToHue,
} from '../entity-renderer-constants';
import { PLAYER_COLORS } from '../tint-utils';

export class ColorEntityPass implements IRenderPass {
    private ctx!: ColorEntityContext;
    /** Whether the textured sprite pass already handled buildings/units with sprites. */
    public texturedBuildingsHandled = false;

    private readonly vertexData = new Float32Array(6 * 2);

    public prepare(ctx: ColorEntityContext): void {
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

        const forceLabels = ctx.layerVisibility.showDecoLabels;

        for (const entity of ctx.sortedEntities) {
            if (this.shouldSkip(entity)) {
                // Still collect label for textured decorations when labels are forced
                if (forceLabels && entity.type === EntityType.MapObject) {
                    const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);
                    this.collectDecoDebugLabel(entity, worldPos, projection, canvasW, canvasH);
                }
                continue;
            }

            const appearance = this.getAppearance(entity);
            const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);

            gl.vertexAttrib2f(ctx.aEntityPos, worldPos.worldX, worldPos.worldY);
            fillQuadVertices(this.vertexData, 0, 0, appearance.scale);
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
            } else if (this.texturedBuildingsHandled) {
                // Entity rendered as color dot because sprite is missing — add a name label
                this.collectMissingSpriteLabel(entity, worldPos, projection, canvasW, canvasH);
            }
        }

        // Collect labels for map objects hidden by layer visibility (no quad, labels only)
        for (const entity of ctx.labelOnlyMapObjects) {
            const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);
            this.collectDecoDebugLabel(entity, worldPos, projection, canvasW, canvasH);
        }
    }

    private shouldSkip(entity: Entity): boolean {
        return this.texturedBuildingsHandled && this.ctx.spriteResolver.hasTexturedSprite(entity);
    }

    private getAppearance(entity: Entity): { color: readonly number[]; scale: number; isDecoration: boolean } {
        const isSelected = this.ctx.selectedEntityIds.has(entity.id);
        const isDecoration = entity.type === EntityType.MapObject;
        if (isSelected) {
            return {
                color: [1.0, 1.0, 0.0, 1.0],
                scale: isDecoration ? 0.8 : this.getEntityScale(entity.type),
                isDecoration,
            };
        }
        const baseColor = isDecoration
            ? decoHueToRgb(entity.subType as number)
            : PLAYER_COLORS[entity.player % PLAYER_COLORS.length]!;
        const scale = isDecoration ? 0.8 : this.getEntityScale(entity.type);
        return { color: baseColor, scale, isDecoration };
    }

    private getEntityScale(entityType: EntityType): number {
        if (entityType === EntityType.Building) {
            return BUILDING_SCALE;
        }
        if (entityType === EntityType.StackedPile) {
            return PILE_SCALE;
        }
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
        this.ctx.debugDecoLabels.push({
            screenX: (clipX * 0.5 + 0.5) * canvasW,
            screenY: (-clipY * 0.5 + 0.5) * canvasH,
            type: entity.subType as number,
            hue: decoTypeToHue(entity.subType as number),
        });
    }

    private collectMissingSpriteLabel(
        entity: Entity,
        worldPos: { worldX: number; worldY: number },
        projection: Float32Array,
        canvasW: number,
        canvasH: number
    ): void {
        const clipX = projection[0]! * worldPos.worldX + projection[12]!;
        const clipY = projection[5]! * worldPos.worldY + projection[13]!;
        const name = this.resolveEntityName(entity);
        this.ctx.debugDecoLabels.push({
            screenX: (clipX * 0.5 + 0.5) * canvasW,
            screenY: (-clipY * 0.5 + 0.5) * canvasH,
            type: entity.subType as number,
            hue: 0,
            name,
        });
    }

    private resolveEntityName(entity: Entity): string {
        if (entity.type === EntityType.Unit) {
            return String(entity.subType as UnitType);
        }
        if (entity.type === EntityType.Building) {
            return String(entity.subType);
        }
        if (entity.type === EntityType.StackedPile) {
            return String(entity.subType);
        }
        return `${entity.type}#${entity.subType}`;
    }
}

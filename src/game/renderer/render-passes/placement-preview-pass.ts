/**
 * PlacementPreviewPass — draws a ghost entity at the preview tile when in placement mode.
 *
 * Supports buildings, resources, and units. Falls back to a color quad if sprites are unavailable.
 */

import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, PlacementPreviewContext } from './types';
import { TilePicker } from '@/game/input/tile-picker';
import { TILE_CENTER_X, TILE_CENTER_Y } from '@/game/systems/coordinate-system';
import { PALETTE_TEXTURE_WIDTH } from '../palette-texture';
import {
    scaleSprite,
    BASE_QUAD,
    BUILDING_SCALE,
    PREVIEW_VALID_COLOR,
    PREVIEW_INVALID_COLOR,
} from '../entity-renderer-constants';
import { TINT_PREVIEW_VALID, TINT_PREVIEW_INVALID } from '../tint-utils';

export class PlacementPreviewPass implements IRenderPass {
    private ctx!: PlacementPreviewContext;

    private readonly vertexData = new Float32Array(6 * 2);

    public prepare(ctx: PlacementPreviewContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        const preview = ctx.placementPreview;
        if (!preview) return;

        const { tile, valid, entityType, subType, race, variation, level } = preview;

        const worldPos = TilePicker.tileToWorld(
            tile.x,
            tile.y,
            ctx.groundHeight,
            ctx.mapSize,
            viewPoint.x,
            viewPoint.y
        );

        if (entityType === 'building') {
            worldPos.worldX -= TILE_CENTER_X;
            worldPos.worldY -= TILE_CENTER_Y * 0.5;
        }

        const tint = valid ? TINT_PREVIEW_VALID : TINT_PREVIEW_INVALID;

        if (ctx.spriteManager?.hasSprites && ctx.spriteBatchRenderer.isInitialized) {
            const rawSprite = ctx.spriteResolver.getPreviewSprite(entityType, subType, variation, race, level);
            if (rawSprite) {
                const spriteEntry = scaleSprite(rawSprite);
                const paletteWidth = PALETTE_TEXTURE_WIDTH;
                const rowsPerPlayer = ctx.spriteManager.paletteManager.textureRowsPerPlayer;
                ctx.spriteBatchRenderer.beginSpriteBatch(
                    gl,
                    projection,
                    paletteWidth,
                    rowsPerPlayer,
                    ctx.renderSettings.antialias
                );
                ctx.spriteBatchRenderer.addSprite(
                    gl,
                    worldPos.worldX,
                    worldPos.worldY,
                    spriteEntry,
                    0,
                    tint[0]!,
                    tint[1]!,
                    tint[2]!,
                    tint[3]!
                );
                ctx.spriteBatchRenderer.endSpriteBatch(gl);
                return;
            }
        }

        // Fallback: color quad
        gl.bindBuffer(gl.ARRAY_BUFFER, ctx.dynamicBuffer);
        const color = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        gl.vertexAttrib2f(ctx.aEntityPos, worldPos.worldX, worldPos.worldY);
        this.fillQuadVertices(0, 0, BUILDING_SCALE);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.vertexAttrib4f(ctx.aColor, color[0]!, color[1]!, color[2]!, color[3]!);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2]! * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1]! * scale + worldY;
        }
    }
}

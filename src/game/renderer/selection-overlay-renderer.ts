import { Entity, EntityType } from '../entity';
import { TilePicker } from '../input/tile-picker';
import { getEntityWorldPos, getInterpolatedWorldPos, type WorldPositionContext } from './world-position';
import {
    FRAME_COLOR,
    FRAME_CORNER_COLOR,
    PATH_COLOR,
    MAX_PATH_DOTS,
    BUILDING_SCALE,
    UNIT_SCALE,
    RESOURCE_SCALE,
    PATH_DOT_SCALE,
    FRAME_PADDING,
    FRAME_THICKNESS,
    FRAME_CORNER_LENGTH,
    BASE_QUAD,
    SELECTION_DOT_SCALE,
    SELECTION_ORIGIN_DOT_SCALE,
    SELECTION_DOT_COLOR,
    SELECTION_ORIGIN_DOT_COLOR,
} from './entity-renderer-constants';

/**
 * Context needed for rendering selection overlays.
 */
export type SelectionRenderContext = WorldPositionContext;

/**
 * Renders selection-related overlays: selection frames and unit paths.
 * Uses the color shader from the parent renderer.
 */
export class SelectionOverlayRenderer {
    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

    /**
     * Draw selection frames around selected entities.
     * Each frame consists of 4 border quads plus 4 corner accent pieces.
     */
    public drawSelectionFrames(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        sortedEntities: Entity[],
        selectedEntityIds: Set<number>,
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): void {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        for (const entity of sortedEntities) {
            if (!selectedEntityIds.has(entity.id)) continue;
            // Skip frames for units - they use dots instead
            if (entity.type === EntityType.Unit) continue;

            const scale = this.getEntityScale(entity.type);
            const worldPos = getEntityWorldPos(entity, ctx);

            gl.vertexAttrib2f(aEntityPos, worldPos.worldX, worldPos.worldY);

            const halfSize = scale * FRAME_PADDING * 0.5;
            const t = FRAME_THICKNESS;

            // Draw 4 border sides as thin quads
            // Top edge
            this.fillRectVertices(-halfSize, halfSize - t, halfSize, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(aColor, FRAME_COLOR[0], FRAME_COLOR[1], FRAME_COLOR[2], FRAME_COLOR[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Bottom edge
            this.fillRectVertices(-halfSize, -halfSize, halfSize, -halfSize + t);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Left edge
            this.fillRectVertices(-halfSize, -halfSize, -halfSize + t, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Right edge
            this.fillRectVertices(halfSize - t, -halfSize, halfSize, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Draw corner accents (brighter, slightly thicker)
            this.drawCornerAccents(gl, buffer, aColor, halfSize, t);
        }
    }

    /**
     * Draw corner accent pieces for a selection frame.
     */
    private drawCornerAccents(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        aColor: number,
        halfSize: number,
        t: number
    ): void {
        const cornerLen = halfSize * FRAME_CORNER_LENGTH;
        const ct = t * 1.8; // Corner thickness
        gl.vertexAttrib4f(aColor, FRAME_CORNER_COLOR[0], FRAME_CORNER_COLOR[1], FRAME_CORNER_COLOR[2], FRAME_CORNER_COLOR[3]);

        // Top-left corner (horizontal + vertical)
        this.fillRectVertices(-halfSize, halfSize - ct, -halfSize + cornerLen, halfSize);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(-halfSize, halfSize - cornerLen, -halfSize + ct, halfSize);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Top-right corner
        this.fillRectVertices(halfSize - cornerLen, halfSize - ct, halfSize, halfSize);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(halfSize - ct, halfSize - cornerLen, halfSize, halfSize);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Bottom-left corner
        this.fillRectVertices(-halfSize, -halfSize, -halfSize + cornerLen, -halfSize + ct);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(-halfSize, -halfSize, -halfSize + ct, -halfSize + cornerLen);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Bottom-right corner
        this.fillRectVertices(halfSize - cornerLen, -halfSize, halfSize, -halfSize + ct);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(halfSize - ct, -halfSize, halfSize, -halfSize + cornerLen);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /**
     * Draw dots along the remaining path of all selected units.
     */
    public drawSelectedUnitPath(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        selectedEntityIds: Set<number>,
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): void {
        if (selectedEntityIds.size === 0) return;

        gl.vertexAttrib4f(aColor, PATH_COLOR[0], PATH_COLOR[1], PATH_COLOR[2], PATH_COLOR[3]);

        for (const entityId of selectedEntityIds) {
            const unitState = ctx.unitStates.get(entityId);
            if (!unitState || unitState.pathIndex >= unitState.path.length) continue;

            const maxDots = Math.min(unitState.path.length, unitState.pathIndex + MAX_PATH_DOTS);
            for (let i = unitState.pathIndex; i < maxDots; i++) {
                const wp = unitState.path[i];
                const worldPos = TilePicker.tileToWorld(
                    wp.x, wp.y,
                    ctx.groundHeight, ctx.mapSize,
                    ctx.viewPoint.x, ctx.viewPoint.y
                );

                gl.vertexAttrib2f(aEntityPos, worldPos.worldX, worldPos.worldY);
                this.fillQuadVertices(0, 0, PATH_DOT_SCALE);
                gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /**
     * Draw selection indicator dots on selected units.
     * Shows a larger dot on the unit sprite and a smaller dot at the logical origin.
     */
    public drawSelectionDots(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        sortedEntities: Entity[],
        selectedEntityIds: Set<number>,
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): void {
        if (selectedEntityIds.size === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        for (const entity of sortedEntities) {
            if (!selectedEntityIds.has(entity.id)) continue;
            if (entity.type !== EntityType.Unit) continue;

            // Get interpolated world position (where sprite is rendered)
            const worldPos = getInterpolatedWorldPos(entity, ctx);

            // Draw larger dot on the unit sprite (offset upward to appear above sprite)
            // Note: negative Y offset moves up in world coordinates
            const spriteTopOffset = 0.7;
            gl.vertexAttrib2f(aEntityPos, worldPos.worldX, worldPos.worldY - spriteTopOffset);
            gl.vertexAttrib4f(
                aColor,
                SELECTION_DOT_COLOR[0],
                SELECTION_DOT_COLOR[1],
                SELECTION_DOT_COLOR[2],
                SELECTION_DOT_COLOR[3]
            );
            this.fillQuadVertices(0, 0, SELECTION_DOT_SCALE);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Draw smaller dot at logical origin (current tile position)
            const originPos = TilePicker.tileToWorld(
                entity.x, entity.y,
                ctx.groundHeight, ctx.mapSize,
                ctx.viewPoint.x, ctx.viewPoint.y
            );
            gl.vertexAttrib2f(aEntityPos, originPos.worldX, originPos.worldY);
            gl.vertexAttrib4f(
                aColor,
                SELECTION_ORIGIN_DOT_COLOR[0],
                SELECTION_ORIGIN_DOT_COLOR[1],
                SELECTION_ORIGIN_DOT_COLOR[2],
                SELECTION_ORIGIN_DOT_COLOR[3]
            );
            this.fillQuadVertices(0, 0, SELECTION_ORIGIN_DOT_SCALE);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /**
     * Get the scale for an entity type.
     */
    private getEntityScale(entityType: EntityType): number {
        if (entityType === EntityType.Building) return BUILDING_SCALE;
        if (entityType === EntityType.StackedResource) return RESOURCE_SCALE;
        return UNIT_SCALE;
    }

    /**
     * Fill vertex data for an axis-aligned rectangle.
     */
    private fillRectVertices(x0: number, y0: number, x1: number, y1: number): void {
        const verts = this.vertexData;
        // Triangle 1: top-left, bottom-left, bottom-right
        verts[0] = x0; verts[1] = y1;
        verts[2] = x0; verts[3] = y0;
        verts[4] = x1; verts[5] = y0;
        // Triangle 2: top-left, bottom-right, top-right
        verts[6] = x0; verts[7] = y1;
        verts[8] = x1; verts[9] = y0;
        verts[10] = x1; verts[11] = y1;
    }

    /**
     * Fill vertex data for a quad centered at origin.
     */
    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale + worldY;
        }
    }
}

import { Entity, EntityType, BuildingType, getBuildingFootprint } from '../entity';
import { TilePicker } from '../input/tile-picker';
import { tileToWorld, heightToWorld } from '../systems/coordinate-system';
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
    FOOTPRINT_TILE_COLOR,
    SHADER_VERTEX_SCALE,
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
     * For buildings, the frame covers the footprint tiles (clickable area).
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

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let centerX = 0, centerY = 0;

            if (entity.type === EntityType.Building) {
                // Get footprint tiles and calculate bounding box in world coordinates
                const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType);
                if (footprint.length > 0) {
                    const bounds = this.calculateFootprintBounds(footprint, ctx);
                    minX = bounds.minX;
                    minY = bounds.minY;
                    maxX = bounds.maxX;
                    maxY = bounds.maxY;
                } else {
                    // Fallback if no footprint
                    const worldPos = getEntityWorldPos(entity, ctx);
                    const scale = this.getEntityScale(entity.type);
                    const half = scale * FRAME_PADDING * 0.5;
                    minX = worldPos.worldX - half;
                    maxX = worldPos.worldX + half;
                    minY = worldPos.worldY - half;
                    maxY = worldPos.worldY + half;
                }
            } else {
                // Non-building entities use simple scale-based sizing
                const worldPos = getEntityWorldPos(entity, ctx);
                const scale = this.getEntityScale(entity.type);
                const half = scale * FRAME_PADDING * 0.5;
                minX = worldPos.worldX - half;
                maxX = worldPos.worldX + half;
                minY = worldPos.worldY - half;
                maxY = worldPos.worldY + half;
            }

            // Calculate center and half-sizes for drawing
            centerX = (minX + maxX) / 2;
            centerY = (minY + maxY) / 2;
            const halfWidth = (maxX - minX) / 2;
            const halfHeight = (maxY - minY) / 2;

            // Position at bounding box center
            gl.vertexAttrib2f(aEntityPos, centerX, centerY);

            const t = FRAME_THICKNESS;

            // Draw 4 border sides as thin quads
            // Top edge
            this.fillRectVertices(-halfWidth, halfHeight - t, halfWidth, halfHeight);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(aColor, FRAME_COLOR[0], FRAME_COLOR[1], FRAME_COLOR[2], FRAME_COLOR[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Bottom edge
            this.fillRectVertices(-halfWidth, -halfHeight, halfWidth, -halfHeight + t);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Left edge
            this.fillRectVertices(-halfWidth, -halfHeight, -halfWidth + t, halfHeight);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Right edge
            this.fillRectVertices(halfWidth - t, -halfHeight, halfWidth, halfHeight);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Draw corner accents (brighter, slightly thicker)
            this.drawCornerAccentsRect(gl, buffer, aColor, halfWidth, halfHeight, t);
        }
    }

    /**
     * Draw corner accent pieces for a selection frame (rectangular).
     */
    private drawCornerAccentsRect(
        gl: WebGL2RenderingContext,
        _buffer: WebGLBuffer,
        aColor: number,
        halfWidth: number,
        halfHeight: number,
        t: number
    ): void {
        const cornerLenX = halfWidth * FRAME_CORNER_LENGTH;
        const cornerLenY = halfHeight * FRAME_CORNER_LENGTH;
        const ct = t * 1.8; // Corner thickness
        gl.vertexAttrib4f(aColor, FRAME_CORNER_COLOR[0], FRAME_CORNER_COLOR[1], FRAME_CORNER_COLOR[2], FRAME_CORNER_COLOR[3]);

        // Top-left corner (horizontal + vertical)
        this.fillRectVertices(-halfWidth, halfHeight - ct, -halfWidth + cornerLenX, halfHeight);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(-halfWidth, halfHeight - cornerLenY, -halfWidth + ct, halfHeight);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Top-right corner
        this.fillRectVertices(halfWidth - cornerLenX, halfHeight - ct, halfWidth, halfHeight);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(halfWidth - ct, halfHeight - cornerLenY, halfWidth, halfHeight);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Bottom-left corner
        this.fillRectVertices(-halfWidth, -halfHeight, -halfWidth + cornerLenX, -halfHeight + ct);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(-halfWidth, -halfHeight, -halfWidth + ct, -halfHeight + cornerLenY);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Bottom-right corner
        this.fillRectVertices(halfWidth - cornerLenX, -halfHeight, halfWidth, -halfHeight + ct);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.fillRectVertices(halfWidth - ct, -halfHeight, halfWidth, -halfHeight + cornerLenY);
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
     * Draw footprint tile highlights for all buildings.
     * Each tile is drawn as a diamond shape matching the isometric tile.
     */
    public drawBuildingFootprints(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        sortedEntities: Entity[],
        _aPosition: number,
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): void {
        const buildings = sortedEntities.filter(e => e.type === EntityType.Building);
        if (buildings.length === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttrib4f(
            aColor,
            FOOTPRINT_TILE_COLOR[0],
            FOOTPRINT_TILE_COLOR[1],
            FOOTPRINT_TILE_COLOR[2],
            FOOTPRINT_TILE_COLOR[3]
        );

        // Diamond vertex data for a single tile (6 vertices for 2 triangles)
        const diamondVerts = new Float32Array(12);

        for (const entity of buildings) {
            const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType);

            for (const tile of footprint) {
                // Get height at integer tile position (fractional coords don't work with groundHeight lookup)
                const idx = ctx.mapSize.toIndex(tile.x, tile.y);
                const hWorld = heightToWorld(ctx.groundHeight[idx] ?? 0);

                // Get world positions for the 4 corners of the tile diamond using pure tileToWorld
                // Top: (x+0.5, y), Right: (x+1, y+0.5), Bottom: (x+0.5, y+1), Left: (x, y+0.5)
                const top = tileToWorld(tile.x + 0.5, tile.y, hWorld, ctx.viewPoint.x, ctx.viewPoint.y);
                const right = tileToWorld(tile.x + 1, tile.y + 0.5, hWorld, ctx.viewPoint.x, ctx.viewPoint.y);
                const bottom = tileToWorld(tile.x + 0.5, tile.y + 1, hWorld, ctx.viewPoint.x, ctx.viewPoint.y);
                const left = tileToWorld(tile.x, tile.y + 0.5, hWorld, ctx.viewPoint.x, ctx.viewPoint.y);

                // Use helper to fill vertices with proper coordinate transformation
                const center = this.fillDiamondFromWorldPositions(diamondVerts, top, right, bottom, left);
                gl.vertexAttrib2f(aEntityPos, center.centerX, center.centerY);

                gl.bufferData(gl.ARRAY_BUFFER, diamondVerts, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /**
     * Calculate world-space bounding box for a building's footprint tiles.
     * Computes all 4 corners of each tile's diamond shape.
     */
    private calculateFootprintBounds(
        footprint: { x: number; y: number }[],
        ctx: SelectionRenderContext
    ): { minX: number; minY: number; maxX: number; maxY: number } {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        // Tile diamonds have corners at fractional tile positions
        const cornerOffsets = [
            { dx: 0.5, dy: 0 },    // Top corner
            { dx: 1, dy: 0.5 },    // Right corner
            { dx: 0.5, dy: 1 },    // Bottom corner
            { dx: 0, dy: 0.5 },    // Left corner
        ];

        for (const tile of footprint) {
            for (const offset of cornerOffsets) {
                const worldPos = TilePicker.tileToWorld(
                    tile.x + offset.dx, tile.y + offset.dy,
                    ctx.groundHeight, ctx.mapSize,
                    ctx.viewPoint.x, ctx.viewPoint.y
                );
                minX = Math.min(minX, worldPos.worldX);
                minY = Math.min(minY, worldPos.worldY);
                maxX = Math.max(maxX, worldPos.worldX);
                maxY = Math.max(maxY, worldPos.worldY);
            }
        }

        return { minX, minY, maxX, maxY };
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
     * Note: These are relative coordinates that will be scaled by SHADER_VERTEX_SCALE.
     */
    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale + worldY;
        }
    }

    /**
     * Fill vertex data for a diamond shape from 4 absolute world positions.
     * Handles the shader's vertex scale factor automatically.
     *
     * @param verts Float32Array(12) to fill with vertex data
     * @param top Top corner world position
     * @param right Right corner world position
     * @param bottom Bottom corner world position
     * @param left Left corner world position
     * @returns The center point for use with gl.vertexAttrib2f(aEntityPos, ...)
     */
    private fillDiamondFromWorldPositions(
        verts: Float32Array,
        top: { worldX: number; worldY: number },
        right: { worldX: number; worldY: number },
        bottom: { worldX: number; worldY: number },
        left: { worldX: number; worldY: number }
    ): { centerX: number; centerY: number } {
        // Calculate center of diamond
        const centerX = (top.worldX + right.worldX + bottom.worldX + left.worldX) / 4;
        const centerY = (top.worldY + right.worldY + bottom.worldY + left.worldY) / 4;

        // Compensate for shader's vertex scale (shader does: pos = a_position * 0.4 + a_entityPos)
        const invScale = 1 / SHADER_VERTEX_SCALE;

        // Triangle 1: top, right, bottom
        verts[0] = (top.worldX - centerX) * invScale;
        verts[1] = (top.worldY - centerY) * invScale;
        verts[2] = (right.worldX - centerX) * invScale;
        verts[3] = (right.worldY - centerY) * invScale;
        verts[4] = (bottom.worldX - centerX) * invScale;
        verts[5] = (bottom.worldY - centerY) * invScale;

        // Triangle 2: top, bottom, left
        verts[6] = (top.worldX - centerX) * invScale;
        verts[7] = (top.worldY - centerY) * invScale;
        verts[8] = (bottom.worldX - centerX) * invScale;
        verts[9] = (bottom.worldY - centerY) * invScale;
        verts[10] = (left.worldX - centerX) * invScale;
        verts[11] = (left.worldY - centerY) * invScale;

        return { centerX, centerY };
    }
}

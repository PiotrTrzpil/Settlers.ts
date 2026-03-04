import { Entity, EntityType, BuildingType, getBuildingFootprint } from '../entity';
import type { TileHighlight } from '../input/render-state';
import { TilePicker } from '../input/tile-picker';
import { tileToWorld, heightToWorld, TILE_CENTER_X, TILE_CENTER_Y } from '../systems/coordinate-system';
import { getEntityWorldPos, type WorldPositionContext } from './world-position';
import type { ServiceAreaRenderData } from './render-context';
import {
    FRAME_COLOR,
    FRAME_CORNER_COLOR,
    PATH_COLOR,
    PATH_TARGET_COLOR,
    MAX_PATH_DOTS,
    BUILDING_SCALE,
    UNIT_SCALE,
    PILE_SCALE,
    PATH_DOT_SCALE,
    FRAME_PADDING,
    FRAME_THICKNESS,
    FRAME_CORNER_LENGTH,
    BASE_QUAD,
    SELECTION_ORIGIN_DOT_SCALE,
    SELECTION_ORIGIN_DOT_COLOR,
    FOOTPRINT_TILE_COLOR,
    SERVICE_AREA_CIRCLE_COLOR,
    SERVICE_AREA_CIRCLE_SEGMENTS,
    SHADER_VERTEX_SCALE,
} from './entity-renderer-constants';

/** Shift a world position from tile center to tile vertex (matching building sprite anchor). */
function shiftBuildingWorldPos(pos: { worldX: number; worldY: number }): { worldX: number; worldY: number } {
    return { worldX: pos.worldX - TILE_CENTER_X, worldY: pos.worldY - TILE_CENTER_Y * 0.5 };
}

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

            let minX: number, minY: number;
            let maxX: number, maxY: number;

            if (entity.type === EntityType.Building) {
                // Get footprint tiles and calculate bounding box in world coordinates
                const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType, entity.race);
                if (footprint.length === 0)
                    throw new Error(`Empty footprint for building ${entity.id} (type ${entity.subType})`);
                const bounds = this.calculateFootprintBounds(footprint, ctx);
                minX = bounds.minX;
                minY = bounds.minY;
                maxX = bounds.maxX;
                maxY = bounds.maxY;
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
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const halfWidth = (maxX - minX) / 2;
            const halfHeight = (maxY - minY) / 2;

            // Position at bounding box center
            gl.vertexAttrib2f(aEntityPos, centerX, centerY);

            const t = FRAME_THICKNESS;

            // Draw 4 border sides as thin quads
            // Top edge
            this.fillRectVertices(-halfWidth, halfHeight - t, halfWidth, halfHeight);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(aColor, FRAME_COLOR[0]!, FRAME_COLOR[1]!, FRAME_COLOR[2]!, FRAME_COLOR[3]!);
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
        gl.vertexAttrib4f(
            aColor,
            FRAME_CORNER_COLOR[0]!,
            FRAME_CORNER_COLOR[1]!,
            FRAME_CORNER_COLOR[2]!,
            FRAME_CORNER_COLOR[3]!
        );

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

        gl.vertexAttrib4f(aColor, PATH_COLOR[0]!, PATH_COLOR[1]!, PATH_COLOR[2]!, PATH_COLOR[3]!);

        for (const entityId of selectedEntityIds) {
            const unitState = ctx.unitStates.get(entityId);
            if (!unitState || unitState.pathIndex >= unitState.path.length) continue;

            const maxDots = Math.min(unitState.path.length, unitState.pathIndex + MAX_PATH_DOTS);
            for (let i = unitState.pathIndex; i < maxDots; i++) {
                const wp = unitState.path[i]!;
                const worldPos = TilePicker.tileToWorld(
                    wp.x,
                    wp.y,
                    ctx.groundHeight,
                    ctx.mapSize,
                    ctx.viewPoint.x,
                    ctx.viewPoint.y
                );

                gl.vertexAttrib2f(aEntityPos, worldPos.worldX, worldPos.worldY);
                this.fillQuadVertices(0, 0, PATH_DOT_SCALE);
                gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }

            // Draw tile-sized circle at final destination
            const target = unitState.path[unitState.path.length - 1]!;
            this.drawTargetCircle(gl, buffer, aEntityPos, aColor, target.x, target.y, ctx);

            // Restore path color for next unit
            gl.vertexAttrib4f(aColor, PATH_COLOR[0]!, PATH_COLOR[1]!, PATH_COLOR[2]!, PATH_COLOR[3]!);
        }
    }

    /**
     * Draw a thick circle on the target tile as a ring of quad segments.
     */
    private drawTargetCircle(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        aEntityPos: number,
        aColor: number,
        tileX: number,
        tileY: number,
        ctx: SelectionRenderContext
    ): void {
        const segments = 16;
        const radius = 0.5; // half-tile in tile space
        const lineWidth = 0.15;

        const idx = ctx.mapSize.toIndex(Math.round(tileX), Math.round(tileY));
        const hWorld = heightToWorld(ctx.groundHeight[idx]!);

        // Generate circle points in tile space, centered on the tile
        const centerTileX = tileX + 0.5;
        const centerTileY = tileY + 0.5;
        const points: { worldX: number; worldY: number }[] = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push(
                tileToWorld(
                    centerTileX + Math.cos(angle) * radius,
                    centerTileY + Math.sin(angle) * radius,
                    hWorld,
                    ctx.viewPoint.x,
                    ctx.viewPoint.y
                )
            );
        }

        // Compute center for entityPos
        let cx = 0,
            cy = 0;
        for (const p of points) {
            cx += p.worldX;
            cy += p.worldY;
        }
        cx /= points.length;
        cy /= points.length;
        gl.vertexAttrib2f(aEntityPos, cx, cy);

        gl.vertexAttrib4f(
            aColor,
            PATH_TARGET_COLOR[0]!,
            PATH_TARGET_COLOR[1]!,
            PATH_TARGET_COLOR[2]!,
            PATH_TARGET_COLOR[3]!
        );

        const invScale = 1 / SHADER_VERTEX_SCALE;
        const segmentVerts = new Float32Array(12);

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i]!;
            const p1 = points[i + 1]!;

            const dx = p1.worldX - p0.worldX;
            const dy = p1.worldY - p0.worldY;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) continue;

            const nx = (-dy / len) * lineWidth * 0.5;
            const ny = (dx / len) * lineWidth * 0.5;

            const ax = (p0.worldX + nx - cx) * invScale;
            const ay = (p0.worldY + ny - cy) * invScale;
            const bx = (p0.worldX - nx - cx) * invScale;
            const by = (p0.worldY - ny - cy) * invScale;
            const cx2 = (p1.worldX - nx - cx) * invScale;
            const cy2 = (p1.worldY - ny - cy) * invScale;
            const dx2 = (p1.worldX + nx - cx) * invScale;
            const dy2 = (p1.worldY + ny - cy) * invScale;

            segmentVerts[0] = ax;
            segmentVerts[1] = ay;
            segmentVerts[2] = bx;
            segmentVerts[3] = by;
            segmentVerts[4] = cx2;
            segmentVerts[5] = cy2;
            segmentVerts[6] = ax;
            segmentVerts[7] = ay;
            segmentVerts[8] = cx2;
            segmentVerts[9] = cy2;
            segmentVerts[10] = dx2;
            segmentVerts[11] = dy2;

            gl.bufferData(gl.ARRAY_BUFFER, segmentVerts, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /**
     * Draw selection origin dots for selected units.
     * Shows a small dot at the logical tile origin (current position).
     * The main selection bracket is drawn as a sprite in EntitySpritePass.
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

            // Draw small dot at logical origin (current tile position)
            const originPos = TilePicker.tileToWorld(
                entity.x,
                entity.y,
                ctx.groundHeight,
                ctx.mapSize,
                ctx.viewPoint.x,
                ctx.viewPoint.y
            );
            gl.vertexAttrib2f(aEntityPos, originPos.worldX, originPos.worldY);
            gl.vertexAttrib4f(
                aColor,
                SELECTION_ORIGIN_DOT_COLOR[0]!,
                SELECTION_ORIGIN_DOT_COLOR[1]!,
                SELECTION_ORIGIN_DOT_COLOR[2]!,
                SELECTION_ORIGIN_DOT_COLOR[3]!
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
            FOOTPRINT_TILE_COLOR[0]!,
            FOOTPRINT_TILE_COLOR[1]!,
            FOOTPRINT_TILE_COLOR[2]!,
            FOOTPRINT_TILE_COLOR[3]!
        );

        // Diamond vertex data for a single tile (6 vertices for 2 triangles)
        const diamondVerts = new Float32Array(12);

        for (const entity of buildings) {
            const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType, entity.race);

            // Build a set of footprint vertex positions for face-inclusion checks.
            // Footprint positions are vertices; a terrain face at (x,y) is only fully
            // covered when all 4 corner vertices (x,y), (x+1,y), (x,y+1), (x+1,y+1) are present.
            const vertexSet = new Set<number>();
            for (const t of footprint) {
                vertexSet.add(t.x * 65536 + t.y);
            }

            for (const tile of footprint) {
                // Only draw if all 4 face corners are in the footprint
                if (
                    !vertexSet.has((tile.x + 1) * 65536 + tile.y) ||
                    !vertexSet.has(tile.x * 65536 + (tile.y + 1)) ||
                    !vertexSet.has((tile.x + 1) * 65536 + (tile.y + 1))
                ) {
                    continue;
                }

                const idx = ctx.mapSize.toIndex(tile.x, tile.y);
                const hWorld = heightToWorld(ctx.groundHeight[idx]!);

                // Terrain face diamond: vertices at (x,y), (x+1,y), (x+1,y+1), (x,y+1)
                // Shift to tile vertex (matching building sprite anchor)
                const top = shiftBuildingWorldPos(
                    tileToWorld(tile.x, tile.y, hWorld, ctx.viewPoint.x, ctx.viewPoint.y)
                );
                const right = shiftBuildingWorldPos(
                    tileToWorld(tile.x + 1, tile.y, hWorld, ctx.viewPoint.x, ctx.viewPoint.y)
                );
                const bottom = shiftBuildingWorldPos(
                    tileToWorld(tile.x + 1, tile.y + 1, hWorld, ctx.viewPoint.x, ctx.viewPoint.y)
                );
                const left = shiftBuildingWorldPos(
                    tileToWorld(tile.x, tile.y + 1, hWorld, ctx.viewPoint.x, ctx.viewPoint.y)
                );

                const center = this.fillDiamondFromWorldPositions(diamondVerts, top, right, bottom, left);
                gl.vertexAttrib2f(aEntityPos, center.centerX, center.centerY);

                gl.bufferData(gl.ARRAY_BUFFER, diamondVerts, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /**
     * Draw circle outlines around service areas for selected hub buildings.
     * Each circle is approximated as a ring of thin quad segments in world space.
     */
    public drawServiceAreaCircles(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        serviceAreas: readonly ServiceAreaRenderData[],
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext,
        color?: readonly number[]
    ): void {
        if (serviceAreas.length === 0) return;

        const c = color ?? SERVICE_AREA_CIRCLE_COLOR;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttrib4f(aColor, c[0]!, c[1]!, c[2]!, c[3]!);

        const segments = SERVICE_AREA_CIRCLE_SEGMENTS;
        const lineWidth = 0.3; // Width of circle outline in tile units

        // 6 vertices per quad segment (2 triangles)
        const segmentVerts = new Float32Array(12);

        for (const area of serviceAreas) {
            // Sample ground height at center for a reasonable base height
            const centerIdx = ctx.mapSize.toIndex(Math.round(area.centerX), Math.round(area.centerY));
            const baseH = heightToWorld(ctx.groundHeight[centerIdx]!);

            // Generate circle points in tile space and convert to world space
            const points: { worldX: number; worldY: number }[] = [];

            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const tileX = area.centerX + 0.5 + Math.cos(angle) * area.radius;
                const tileY = area.centerY + 0.5 + Math.sin(angle) * area.radius;

                // Sample height at this tile position for terrain-following
                const sampleX = Math.round(tileX);
                const sampleY = Math.round(tileY);
                const inBounds =
                    sampleX >= 0 && sampleX < ctx.mapSize.width && sampleY >= 0 && sampleY < ctx.mapSize.height;
                const h = inBounds ? heightToWorld(ctx.groundHeight[ctx.mapSize.toIndex(sampleX, sampleY)]!) : baseH;

                points.push(tileToWorld(tileX, tileY, h, ctx.viewPoint.x, ctx.viewPoint.y));
            }

            // Compute center of all points for use as entityPos
            let cx = 0,
                cy = 0;
            for (const p of points) {
                cx += p.worldX;
                cy += p.worldY;
            }
            cx /= points.length;
            cy /= points.length;
            gl.vertexAttrib2f(aEntityPos, cx, cy);

            const invScale = 1 / SHADER_VERTEX_SCALE;

            // Draw quad segments connecting consecutive circle points
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[i]!;
                const p1 = points[i + 1]!;

                // Direction vector from p0 to p1
                const dx = p1.worldX - p0.worldX;
                const dy = p1.worldY - p0.worldY;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len < 0.001) continue;

                // Normal (perpendicular) for line width
                const nx = (-dy / len) * lineWidth * 0.5;
                const ny = (dx / len) * lineWidth * 0.5;

                // Quad corners (outer and inner edges)
                const ax = (p0.worldX + nx - cx) * invScale;
                const ay = (p0.worldY + ny - cy) * invScale;
                const bx = (p0.worldX - nx - cx) * invScale;
                const by = (p0.worldY - ny - cy) * invScale;
                const cx2 = (p1.worldX - nx - cx) * invScale;
                const cy2 = (p1.worldY - ny - cy) * invScale;
                const dx2 = (p1.worldX + nx - cx) * invScale;
                const dy2 = (p1.worldY + ny - cy) * invScale;

                // Triangle 1: a, b, c
                segmentVerts[0] = ax;
                segmentVerts[1] = ay;
                segmentVerts[2] = bx;
                segmentVerts[3] = by;
                segmentVerts[4] = cx2;
                segmentVerts[5] = cy2;
                // Triangle 2: a, c, d
                segmentVerts[6] = ax;
                segmentVerts[7] = ay;
                segmentVerts[8] = cx2;
                segmentVerts[9] = cy2;
                segmentVerts[10] = dx2;
                segmentVerts[11] = dy2;

                gl.bufferData(gl.ARRAY_BUFFER, segmentVerts, gl.DYNAMIC_DRAW);
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
        let minX = Infinity,
            minY = Infinity;
        let maxX = -Infinity,
            maxY = -Infinity;

        // Tile diamonds have corners at fractional tile positions
        const cornerOffsets = [
            { dx: 0.5, dy: 0 }, // Top corner
            { dx: 1, dy: 0.5 }, // Right corner
            { dx: 0.5, dy: 1 }, // Bottom corner
            { dx: 0, dy: 0.5 }, // Left corner
        ];

        for (const tile of footprint) {
            // Get height at integer tile position
            const idx = ctx.mapSize.toIndex(tile.x, tile.y);
            const hWorld = heightToWorld(ctx.groundHeight[idx]!);

            for (const offset of cornerOffsets) {
                // Use pure tileToWorld for fractional coords (tile corners)
                // Shift to tile vertex (matching building sprite anchor)
                const worldPos = shiftBuildingWorldPos(
                    tileToWorld(tile.x + offset.dx, tile.y + offset.dy, hWorld, ctx.viewPoint.x, ctx.viewPoint.y)
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
        if (entityType === EntityType.StackedPile) return PILE_SCALE;
        return UNIT_SCALE;
    }

    /**
     * Fill vertex data for an axis-aligned rectangle.
     */
    private fillRectVertices(x0: number, y0: number, x1: number, y1: number): void {
        const verts = this.vertexData;
        // Triangle 1: top-left, bottom-left, bottom-right
        verts[0] = x0;
        verts[1] = y1;
        verts[2] = x0;
        verts[3] = y0;
        verts[4] = x1;
        verts[5] = y0;
        // Triangle 2: top-left, bottom-right, top-right
        verts[6] = x0;
        verts[7] = y1;
        verts[8] = x1;
        verts[9] = y0;
        verts[10] = x1;
        verts[11] = y1;
    }

    /**
     * Fill vertex data for a quad centered at origin.
     * Note: These are relative coordinates that will be scaled by SHADER_VERTEX_SCALE.
     */
    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2]! * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1]! * scale + worldY;
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

    /**
     * Draw ring highlights at tile positions (for debug tools like stack-adjust).
     * Each highlight is a circle ring with the configured color and alpha.
     */
    public drawTileHighlights(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        highlights: TileHighlight[],
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): void {
        if (highlights.length === 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        const segments = 16;
        const radius = 0.5;
        const lineWidth = 0.12;
        const invScale = 1 / SHADER_VERTEX_SCALE;
        const segmentVerts = new Float32Array(12);

        for (const h of highlights) {
            const idx = ctx.mapSize.toIndex(Math.round(h.x), Math.round(h.y));
            const hWorld = heightToWorld(ctx.groundHeight[idx]!);
            const alpha = h.alpha ?? 0.5;
            const [r, g, b] = parseHexColor(h.color);

            const centerTileX = h.x + 0.5;
            const centerTileY = h.y + 0.5;

            const points = this.generateCirclePoints(segments, centerTileX, centerTileY, radius, hWorld, ctx);

            let cx = 0;
            let cy = 0;
            for (const p of points) {
                cx += p.worldX;
                cy += p.worldY;
            }
            cx /= points.length;
            cy /= points.length;

            gl.vertexAttrib2f(aEntityPos, cx, cy);
            gl.vertexAttrib4f(aColor, r, g, b, alpha);

            for (let i = 0; i < points.length - 1; i++) {
                this.buildRingSegment(segmentVerts, points[i]!, points[i + 1]!, cx, cy, lineWidth, invScale);
                gl.bufferData(gl.ARRAY_BUFFER, segmentVerts, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /** Generate circle points in world space around a tile center. */
    private generateCirclePoints(
        segments: number,
        centerTileX: number,
        centerTileY: number,
        radius: number,
        hWorld: number,
        ctx: SelectionRenderContext
    ): { worldX: number; worldY: number }[] {
        const points: { worldX: number; worldY: number }[] = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push(
                tileToWorld(
                    centerTileX + Math.cos(angle) * radius,
                    centerTileY + Math.sin(angle) * radius,
                    hWorld,
                    ctx.viewPoint.x,
                    ctx.viewPoint.y
                )
            );
        }
        return points;
    }

    /** Build two-triangle quad for one ring segment between two adjacent circle points. */
    private buildRingSegment(
        verts: Float32Array,
        p0: { worldX: number; worldY: number },
        p1: { worldX: number; worldY: number },
        cx: number,
        cy: number,
        lineWidth: number,
        invScale: number
    ): void {
        const dx = p1.worldX - p0.worldX;
        const dy = p1.worldY - p0.worldY;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return;

        const nx = (-dy / len) * lineWidth * 0.5;
        const ny = (dx / len) * lineWidth * 0.5;

        verts[0] = (p0.worldX + nx - cx) * invScale;
        verts[1] = (p0.worldY + ny - cy) * invScale;
        verts[2] = (p0.worldX - nx - cx) * invScale;
        verts[3] = (p0.worldY - ny - cy) * invScale;
        verts[4] = (p1.worldX - nx - cx) * invScale;
        verts[5] = (p1.worldY - ny - cy) * invScale;
        verts[6] = (p0.worldX + nx - cx) * invScale;
        verts[7] = (p0.worldY + ny - cy) * invScale;
        verts[8] = (p1.worldX - nx - cx) * invScale;
        verts[9] = (p1.worldY - ny - cy) * invScale;
        verts[10] = (p1.worldX + nx - cx) * invScale;
        verts[11] = (p1.worldY + ny - cy) * invScale;
    }
}

/** Parse '#rrggbb' hex string to [r, g, b] in 0-1 range. */
function parseHexColor(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

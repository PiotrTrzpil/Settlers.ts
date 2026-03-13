import { Entity, EntityType, getBuildingFootprint, BuildingType, tileKey } from '../entity';
import { getBuildingDoorPos } from '../data/game-data-access';
import { getBuildingBlockArea } from '../buildings/types';
import type { TileHighlight } from '../input/render-state';
import { TilePicker } from '../input/tile-picker';
import { tileToWorld, heightToWorld, TILE_CENTER_X, TILE_CENTER_Y } from '../systems/coordinate-system';
import { getEntityWorldPos, type WorldPositionContext } from './world-position';
import type { CircleRenderData } from './render-context';
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
    FOOTPRINT_EDGE_COLOR,
    FOOTPRINT_DOOR_COLOR,
    CIRCLE_OVERLAY_SEGMENTS,
    SHADER_VERTEX_SCALE,
} from './entity-renderer-constants';

/** Shift a world position from tile center to tile vertex (matching building sprite anchor). */
function shiftBuildingWorldPos(pos: { worldX: number; worldY: number }): { worldX: number; worldY: number } {
    return { worldX: pos.worldX - TILE_CENTER_X, worldY: pos.worldY - TILE_CENTER_Y * 0.5 };
}

/**
 * Compute world-space bounding box for a building footprint.
 * Uses the actual terrain face vertices (integer offsets) so the bounds match the visible tiles.
 */
export function calculateFootprintBounds(
    footprint: { x: number; y: number }[],
    mapSize: { toIndex(x: number, y: number): number },
    groundHeight: Uint8Array,
    viewPointX: number,
    viewPointY: number
): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity,
        minY = Infinity;
    let maxX = -Infinity,
        maxY = -Infinity;

    // Terrain face vertices at integer offsets — (0,0),(1,0),(1,1),(0,1)
    const cornerOffsets = [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 0, dy: 1 },
    ];

    for (const tile of footprint) {
        const idx = mapSize.toIndex(tile.x, tile.y);
        const hWorld = heightToWorld(groundHeight[idx]!);
        for (const offset of cornerOffsets) {
            const worldPos = shiftBuildingWorldPos(
                tileToWorld(tile.x + offset.dx, tile.y + offset.dy, hWorld, viewPointX, viewPointY)
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
            if (!selectedEntityIds.has(entity.id)) {
                continue;
            }
            // Skip units (use dots) and buildings (use sprite-based indicator in entity-sprite-pass)
            if (entity.type === EntityType.Unit) {
                continue;
            }
            if (entity.type === EntityType.Building) {
                continue;
            }

            // Non-building entities use simple scale-based sizing
            const worldPos = getEntityWorldPos(entity, ctx);
            const scale = this.getEntityScale(entity.type);
            const half = scale * FRAME_PADDING * 0.5;
            const minX = worldPos.worldX - half;
            const maxX = worldPos.worldX + half;
            const minY = worldPos.worldY - half;
            const maxY = worldPos.worldY + half;

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
        if (selectedEntityIds.size === 0) {
            return;
        }

        gl.vertexAttrib4f(aColor, PATH_COLOR[0]!, PATH_COLOR[1]!, PATH_COLOR[2]!, PATH_COLOR[3]!);

        for (const entityId of selectedEntityIds) {
            const unitState = ctx.unitStates.get(entityId);
            if (!unitState || unitState.pathIndex >= unitState.path.length) {
                continue;
            }

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
            if (len < 0.001) {
                continue;
            }

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
        if (selectedEntityIds.size === 0) {
            return;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        for (const entity of sortedEntities) {
            if (!selectedEntityIds.has(entity.id)) {
                continue;
            }
            if (entity.type !== EntityType.Unit) {
                continue;
            }

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
        if (buildings.length === 0) {
            return;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        // Diamond vertex data for a single tile (6 vertices for 2 triangles)
        const diamondVerts = new Float32Array(12);

        for (const entity of buildings) {
            const buildingType = entity.subType as BuildingType;
            const footprint = getBuildingFootprint(entity.x, entity.y, buildingType, entity.race);
            const doorPos = getBuildingDoorPos(entity.x, entity.y, entity.race, buildingType);

            // Block area tiles (actual movement blocking) shown in cyan
            // Placement-only tiles (outer exclusion zone) shown in purple
            const blockKeys = new Set<string>();
            try {
                const blockArea = getBuildingBlockArea(entity.x, entity.y, buildingType, entity.race);
                for (const t of blockArea) {
                    blockKeys.add(tileKey(t.x, t.y));
                }
            } catch {
                /* no block data — treat all as block area */
            }

            for (const tile of footprint) {
                const color = this.getFootprintTileColor(tile, doorPos, blockKeys);
                gl.vertexAttrib4f(aColor, color[0]!, color[1]!, color[2]!, color[3]!);

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

    /** Pick tile color: door=orange-red, block area=cyan, placement-only zone=purple. */
    private getFootprintTileColor(
        tile: { x: number; y: number },
        doorPos: { x: number; y: number },
        blockKeys: Set<string>
    ): readonly number[] {
        if (tile.x === doorPos.x && tile.y === doorPos.y) {
            return FOOTPRINT_DOOR_COLOR;
        }
        if (blockKeys.size === 0 || blockKeys.has(tileKey(tile.x, tile.y))) {
            return FOOTPRINT_TILE_COLOR;
        }
        return FOOTPRINT_EDGE_COLOR;
    }

    /**
     * Draw circle outlines around areas (work areas, etc.).
     * Each circle is approximated as a ring of thin quad segments in world space.
     */
    public drawCircleOverlays(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        circles: readonly CircleRenderData[],
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext,
        color: readonly number[]
    ): void {
        if (circles.length === 0) {
            return;
        }

        const c = color;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttrib4f(aColor, c[0]!, c[1]!, c[2]!, c[3]!);

        const segments = CIRCLE_OVERLAY_SEGMENTS;
        const lineWidth = 0.3; // Width of circle outline in tile units

        // 6 vertices per quad segment (2 triangles)
        const segmentVerts = new Float32Array(12);

        for (const area of circles) {
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
                if (len < 0.001) {
                    continue;
                }

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
     * Get the scale for an entity type.
     */
    private getEntityScale(entityType: EntityType): number {
        if (entityType === EntityType.Building) {
            return BUILDING_SCALE;
        }
        if (entityType === EntityType.StackedPile) {
            return PILE_SCALE;
        }
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
     * Draw diamond highlights at tile positions (matching isometric tile shape).
     * Uses solid fill or outline depending on the highlight style.
     */
    public drawTileHighlights(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        highlights: TileHighlight[],
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): void {
        if (highlights.length === 0) {
            return;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        const diamondVerts = new Float32Array(12);

        for (const h of highlights) {
            const tx = Math.round(h.x);
            const ty = Math.round(h.y);
            const idx = ctx.mapSize.toIndex(tx, ty);
            const hWorld = heightToWorld(ctx.groundHeight[idx]!);
            const alpha = h.alpha ?? 0.5;
            const [r, g, b] = parseHexColor(h.color);

            gl.vertexAttrib4f(aColor, r, g, b, alpha);

            const top = shiftBuildingWorldPos(tileToWorld(tx, ty, hWorld, ctx.viewPoint.x, ctx.viewPoint.y));
            const right = shiftBuildingWorldPos(tileToWorld(tx + 1, ty, hWorld, ctx.viewPoint.x, ctx.viewPoint.y));
            const bottom = shiftBuildingWorldPos(tileToWorld(tx + 1, ty + 1, hWorld, ctx.viewPoint.x, ctx.viewPoint.y));
            const left = shiftBuildingWorldPos(tileToWorld(tx, ty + 1, hWorld, ctx.viewPoint.x, ctx.viewPoint.y));

            const center = this.fillDiamondFromWorldPositions(diamondVerts, top, right, bottom, left);
            gl.vertexAttrib2f(aEntityPos, center.centerX, center.centerY);

            gl.bufferData(gl.ARRAY_BUFFER, diamondVerts, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }
}

/** Parse '#rrggbb' hex string to [r, g, b] in 0-1 range. */
function parseHexColor(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

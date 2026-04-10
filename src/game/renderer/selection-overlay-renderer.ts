import { Entity, EntityType, Tile } from '../entity';
import { TilePicker } from '../input/tile-picker';
import type { TileHighlight } from '../input/render-state';
import { tileToWorld, heightToWorld, TILE_CENTER_X, TILE_CENTER_Y } from '../systems/coordinate-system';
import { getEntityWorldPos, type WorldPositionContext } from './world-position';
import type { CircleRenderData } from './render-context';
import { CircleRingRenderer } from './overlay-renderers/circle-ring-renderer';
import { TileDiamondRenderer } from './overlay-renderers/tile-diamond-renderer';
import type { OverlaySession } from './overlay-renderers/overlay-session';
import {
    FRAME_COLOR,
    FRAME_CORNER_COLOR,
    PATH_COLOR,
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
    footprint: Tile[],
    mapSize: { toIndex(tile: Tile): number },
    groundHeight: Uint8Array,
    viewPointX: number,
    viewPointY: number
): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity,
        minY = Infinity;
    let maxX = -Infinity,
        maxY = -Infinity;

    const cornerOffsets = [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 0, dy: 1 },
    ];

    for (const tile of footprint) {
        const idx = mapSize.toIndex(tile);
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

/** Context needed for rendering selection overlays. */
export type SelectionRenderContext = WorldPositionContext;

/**
 * Renders selection-related overlays: selection frames, unit paths, dots, footprints, circles.
 *
 * Usage (session pattern — capture GL state once, then draw):
 * ```
 * const s = overlay.begin(gl, buffer, aEntityPos, aColor, ctx);
 * s.drawSelectionFrames(entities, selectedIds);
 * s.drawSelectionDots(entities, selectedIds);
 * s.drawTileHighlights(highlights);
 * ```
 */
export class SelectionOverlayRenderer {
    private circleRenderer = new CircleRingRenderer();
    private tileRenderer = new TileDiamondRenderer();

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

    // Per-session state (set by begin())
    private gl!: WebGL2RenderingContext;
    private buffer!: WebGLBuffer;
    private aEntityPos!: number;
    private aColor!: number;
    private ctx!: SelectionRenderContext;

    /**
     * Begin a draw session — captures GL state so draw methods only need domain data.
     * Returns `this` for chaining.
     */
    public begin(
        gl: WebGL2RenderingContext,
        buffer: WebGLBuffer,
        aEntityPos: number,
        aColor: number,
        ctx: SelectionRenderContext
    ): this {
        this.gl = gl;
        this.buffer = buffer;
        this.aEntityPos = aEntityPos;
        this.aColor = aColor;
        this.ctx = ctx;
        return this;
    }

    /** Session context for sub-renderers. */
    private get session(): OverlaySession {
        return { gl: this.gl, buffer: this.buffer, aEntityPos: this.aEntityPos, aColor: this.aColor, ctx: this.ctx };
    }

    // ========================================================================
    // Public draw methods — domain data only, no GL plumbing
    // ========================================================================

    /** Draw selection frames around selected non-building, non-unit entities. */
    public drawSelectionFrames(sortedEntities: Entity[], selectedEntityIds: Set<number>): void {
        const { gl, buffer, aEntityPos, ctx } = this;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        for (const entity of sortedEntities) {
            if (!selectedEntityIds.has(entity.id)) {
                continue;
            }
            if (entity.type === EntityType.Unit || entity.type === EntityType.Building) {
                continue;
            }

            const worldPos = getEntityWorldPos(entity, ctx);
            const scale = getEntityScale(entity.type);
            const half = scale * FRAME_PADDING * 0.5;
            const centerX = worldPos.worldX;
            const centerY = worldPos.worldY;
            const halfWidth = half;
            const halfHeight = half;

            gl.vertexAttrib2f(aEntityPos, centerX, centerY);

            const t = FRAME_THICKNESS;

            // 4 border sides
            this.fillRectAndDraw(-halfWidth, halfHeight - t, halfWidth, halfHeight, FRAME_COLOR);
            this.fillRectAndDraw(-halfWidth, -halfHeight, halfWidth, -halfHeight + t, FRAME_COLOR);
            this.fillRectAndDraw(-halfWidth, -halfHeight, -halfWidth + t, halfHeight, FRAME_COLOR);
            this.fillRectAndDraw(halfWidth - t, -halfHeight, halfWidth, halfHeight, FRAME_COLOR);

            // Corner accents
            this.drawCornerAccents(halfWidth, halfHeight, t);
        }
    }

    /** Draw origin dots for selected units. */
    public drawSelectionDots(sortedEntities: Entity[], selectedEntityIds: Set<number>): void {
        if (selectedEntityIds.size === 0) {
            return;
        }
        const { gl, buffer, aEntityPos, aColor, ctx } = this;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        for (const entity of sortedEntities) {
            if (!selectedEntityIds.has(entity.id) || entity.type !== EntityType.Unit) {
                continue;
            }

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

    /** Draw path dots and target circle for selected units. */
    public drawSelectedUnitPath(selectedEntityIds: Set<number>): void {
        if (selectedEntityIds.size === 0) {
            return;
        }
        const { gl, aEntityPos, aColor, ctx } = this;
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

            const target = unitState.path[unitState.path.length - 1]!;
            this.circleRenderer.drawTargetCircle(this.session, target.x, target.y);

            gl.vertexAttrib4f(aColor, PATH_COLOR[0]!, PATH_COLOR[1]!, PATH_COLOR[2]!, PATH_COLOR[3]!);
        }
    }

    /** Draw circle outlines around work areas. */
    public drawCircleOverlays(circles: readonly CircleRenderData[], color: readonly number[]): void {
        this.circleRenderer.drawCircleOverlays(this.session, circles, color);
    }

    /** Draw footprint tile highlights for all buildings. */
    public drawBuildingFootprints(sortedEntities: Entity[]): void {
        this.tileRenderer.drawBuildingFootprints(this.session, sortedEntities);
    }

    /** Draw diamond highlights at tile positions. */
    public drawTileHighlights(highlights: TileHighlight[]): void {
        this.tileRenderer.drawTileHighlights(this.session, highlights);
    }

    /** Draw tile highlights and direction arrows for all unit entities. */
    public drawUnitPositions(sortedEntities: Entity[]): void {
        this.tileRenderer.drawUnitPositions(this.session, sortedEntities);
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    /** Fill a rect and draw it immediately. */
    private fillRectAndDraw(x0: number, y0: number, x1: number, y1: number, color: readonly number[]): void {
        const verts = this.vertexData;
        verts[0] = x0;
        verts[1] = y1;
        verts[2] = x0;
        verts[3] = y0;
        verts[4] = x1;
        verts[5] = y0;
        verts[6] = x0;
        verts[7] = y1;
        verts[8] = x1;
        verts[9] = y0;
        verts[10] = x1;
        verts[11] = y1;

        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.vertexData, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttrib4f(this.aColor, color[0]!, color[1]!, color[2]!, color[3]!);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    private drawCornerAccents(halfWidth: number, halfHeight: number, t: number): void {
        const cx = halfWidth * FRAME_CORNER_LENGTH;
        const cy = halfHeight * FRAME_CORNER_LENGTH;
        const ct = t * 1.8;
        const c = FRAME_CORNER_COLOR;
        const hw = halfWidth,
            hh = halfHeight;

        // 4 corners × 2 bars each (horizontal + vertical)
        const bars: [number, number, number, number][] = [
            [-hw, hh - ct, -hw + cx, hh],
            [-hw, hh - cy, -hw + ct, hh], // top-left
            [hw - cx, hh - ct, hw, hh],
            [hw - ct, hh - cy, hw, hh], // top-right
            [-hw, -hh, -hw + cx, -hh + ct],
            [-hw, -hh, -hw + ct, -hh + cy], // bottom-left
            [hw - cx, -hh, hw, -hh + ct],
            [hw - ct, -hh, hw, -hh + cy], // bottom-right
        ];

        for (const [x0, y0, x1, y1] of bars) {
            this.fillRectAndDraw(x0, y0, x1, y1, c);
        }
    }

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2]! * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1]! * scale + worldY;
        }
    }
}

function getEntityScale(entityType: EntityType): number {
    if (entityType === EntityType.Building) {
        return BUILDING_SCALE;
    }
    if (entityType === EntityType.StackedPile) {
        return PILE_SCALE;
    }
    return UNIT_SCALE;
}

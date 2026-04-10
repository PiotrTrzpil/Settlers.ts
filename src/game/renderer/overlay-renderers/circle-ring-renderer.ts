import { heightToWorld, tileToWorld } from '../../systems/coordinate-system';
import type { CircleRenderData } from '../render-context';
import { CIRCLE_OVERLAY_SEGMENTS, PATH_TARGET_COLOR, SHADER_VERTEX_SCALE } from '../entity-renderer-constants';
import type { OverlaySession } from './overlay-session';

/**
 * Renders circle and ring overlays in world space.
 * Handles work-area circles and path-target circles as rings of quad segments.
 */
export class CircleRingRenderer {
    // Pre-allocated buffer for ring segment vertices (6 vertices * 2 coords)
    private readonly segmentVerts = new Float32Array(12);

    /** Draw circle outlines around areas (work areas, etc.). */
    public drawCircleOverlays(s: OverlaySession, circles: readonly CircleRenderData[], color: readonly number[]): void {
        if (circles.length === 0) {
            return;
        }

        s.gl.bindBuffer(s.gl.ARRAY_BUFFER, s.buffer);
        s.gl.vertexAttrib4f(s.aColor, color[0]!, color[1]!, color[2]!, color[3]!);

        const segments = CIRCLE_OVERLAY_SEGMENTS;
        const lineWidth = 0.3;

        for (const area of circles) {
            const centerIdx = s.ctx.mapSize.toIndex({ x: Math.round(area.centerX), y: Math.round(area.centerY) });
            const baseH = heightToWorld(s.ctx.groundHeight[centerIdx]!);

            const points = this.generateCirclePoints(
                area.centerX + 0.5,
                area.centerY + 0.5,
                area.radius,
                segments,
                baseH,
                s
            );
            const center = computeCenter(points);
            s.gl.vertexAttrib2f(s.aEntityPos, center.cx, center.cy);
            this.drawRing(s.gl, points, center.cx, center.cy, lineWidth);
        }
    }

    /** Draw a thick circle on the target tile as a ring of quad segments. */
    public drawTargetCircle(s: OverlaySession, tileX: number, tileY: number): void {
        const segments = 16;
        const radius = 0.5;
        const lineWidth = 0.15;

        const idx = s.ctx.mapSize.toIndex({ x: Math.round(tileX), y: Math.round(tileY) });
        const hWorld = heightToWorld(s.ctx.groundHeight[idx]!);

        const points: { worldX: number; worldY: number }[] = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push(
                tileToWorld(
                    tileX + 0.5 + Math.cos(angle) * radius,
                    tileY + 0.5 + Math.sin(angle) * radius,
                    hWorld,
                    s.ctx.viewPoint.x,
                    s.ctx.viewPoint.y
                )
            );
        }

        const center = computeCenter(points);
        s.gl.vertexAttrib2f(s.aEntityPos, center.cx, center.cy);
        s.gl.vertexAttrib4f(
            s.aColor,
            PATH_TARGET_COLOR[0]!,
            PATH_TARGET_COLOR[1]!,
            PATH_TARGET_COLOR[2]!,
            PATH_TARGET_COLOR[3]!
        );
        this.drawRing(s.gl, points, center.cx, center.cy, lineWidth);
    }

    /** Generate circle points in tile space with terrain-following height sampling. */
    private generateCirclePoints(
        centerTileX: number,
        centerTileY: number,
        radius: number,
        segments: number,
        baseH: number,
        s: OverlaySession
    ): { worldX: number; worldY: number }[] {
        const points: { worldX: number; worldY: number }[] = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const tx = centerTileX + Math.cos(angle) * radius;
            const ty = centerTileY + Math.sin(angle) * radius;

            const sampleX = Math.round(tx);
            const sampleY = Math.round(ty);
            const inBounds =
                sampleX >= 0 && sampleX < s.ctx.mapSize.width && sampleY >= 0 && sampleY < s.ctx.mapSize.height;
            const h = inBounds
                ? heightToWorld(s.ctx.groundHeight[s.ctx.mapSize.toIndex({ x: sampleX, y: sampleY })]!)
                : baseH;
            points.push(tileToWorld(tx, ty, h, s.ctx.viewPoint.x, s.ctx.viewPoint.y));
        }
        return points;
    }

    /** Draw a ring of quad segments connecting consecutive circle points. */
    private drawRing(
        gl: WebGL2RenderingContext,
        points: { worldX: number; worldY: number }[],
        cx: number,
        cy: number,
        lineWidth: number
    ): void {
        const invScale = 1 / SHADER_VERTEX_SCALE;
        const verts = this.segmentVerts;

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

            verts[0] = ax;
            verts[1] = ay;
            verts[2] = bx;
            verts[3] = by;
            verts[4] = cx2;
            verts[5] = cy2;
            verts[6] = ax;
            verts[7] = ay;
            verts[8] = cx2;
            verts[9] = cy2;
            verts[10] = dx2;
            verts[11] = dy2;

            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }
}

/** Compute the centroid of a set of world-space points. */
function computeCenter(points: { worldX: number; worldY: number }[]): { cx: number; cy: number } {
    let cx = 0,
        cy = 0;
    for (const p of points) {
        cx += p.worldX;
        cy += p.worldY;
    }
    return { cx: cx / points.length, cy: cy / points.length };
}

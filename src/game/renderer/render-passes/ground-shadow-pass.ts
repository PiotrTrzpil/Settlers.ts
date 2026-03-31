/**
 * GroundShadowPass — draws soft elliptical ambient-occlusion shadows under units.
 *
 * Renders at BehindEntities layer so shadows appear on the ground beneath unit sprites.
 * Uses a dedicated shader with radial gradient falloff for a natural contact shadow look.
 * All visible unit shadows are batched into a single draw call per frame.
 */

import { EntityType } from '@/game/entity';
import type { IViewPoint } from '../i-view-point';
import type { PassContext, PluggableRenderPass } from './types';
import { getRenderEntityWorldPos } from '../world-position';
import { ShaderProgram } from '../shader-program';
import {
    GROUND_SHADOW_HALF_WIDTH,
    GROUND_SHADOW_HALF_HEIGHT,
    GROUND_SHADOW_OPACITY,
    GROUND_SHADOW_Y_OFFSET,
} from '../entity-renderer-constants';

import vertSrc from '../shaders/ground-shadow-vert.glsl';
import fragSrc from '../shaders/ground-shadow-frag.glsl';

/** Floats per vertex: position(2) + uv(2) */
const FLOATS_PER_VERTEX = 4;
/** Vertices per shadow quad (two triangles) */
const VERTS_PER_QUAD = 6;
const FLOATS_PER_SHADOW = VERTS_PER_QUAD * FLOATS_PER_VERTEX;
/** Max shadows per batch draw call */
const MAX_SHADOWS = 500;

export class GroundShadowPass implements PluggableRenderPass {
    private ctx!: PassContext;

    // Lazy-initialized GPU resources
    private shader: ShaderProgram | null = null;
    private buffer: WebGLBuffer | null = null;
    private vertexData = new Float32Array(MAX_SHADOWS * FLOATS_PER_SHADOW);

    // Cached attribute/uniform locations
    private aPosition = -1;
    private aUv = -1;
    private uOpacity: WebGLUniformLocation | null = null;

    public prepare(ctx: PassContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (ctx.sortedEntities.length === 0) {
            return;
        }

        this.ensureInitialized(gl);

        const shader = this.shader!;
        shader.use();
        shader.setMatrix('projection', projection);
        gl.uniform1f(this.uOpacity, GROUND_SHADOW_OPACITY);

        // Fill vertex buffer with shadow quads for visible units
        let shadowCount = 0;
        const verts = this.vertexData;

        for (const entity of ctx.sortedEntities) {
            if (entity.type !== EntityType.Unit) {
                continue;
            }
            if (shadowCount >= MAX_SHADOWS) {
                break;
            }

            const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);
            const cx = worldPos.worldX;
            const cy = worldPos.worldY + GROUND_SHADOW_Y_OFFSET;
            const hw = GROUND_SHADOW_HALF_WIDTH;
            const hh = GROUND_SHADOW_HALF_HEIGHT;

            const base = shadowCount * FLOATS_PER_SHADOW;

            // Triangle 1: TL, BL, BR
            // TL
            verts[base] = cx - hw;
            verts[base + 1] = cy - hh;
            verts[base + 2] = -1.0;
            verts[base + 3] = -1.0;
            // BL
            verts[base + 4] = cx - hw;
            verts[base + 5] = cy + hh;
            verts[base + 6] = -1.0;
            verts[base + 7] = 1.0;
            // BR
            verts[base + 8] = cx + hw;
            verts[base + 9] = cy + hh;
            verts[base + 10] = 1.0;
            verts[base + 11] = 1.0;

            // Triangle 2: TL, BR, TR
            // TL
            verts[base + 12] = cx - hw;
            verts[base + 13] = cy - hh;
            verts[base + 14] = -1.0;
            verts[base + 15] = -1.0;
            // BR
            verts[base + 16] = cx + hw;
            verts[base + 17] = cy + hh;
            verts[base + 18] = 1.0;
            verts[base + 19] = 1.0;
            // TR
            verts[base + 20] = cx + hw;
            verts[base + 21] = cy - hh;
            verts[base + 22] = 1.0;
            verts[base + 23] = -1.0;

            shadowCount++;
        }

        if (shadowCount === 0) {
            return;
        }

        // Upload and draw
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, shadowCount * FLOATS_PER_SHADOW), gl.DYNAMIC_DRAW);

        const stride = FLOATS_PER_VERTEX * 4; // bytes
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.aUv);
        gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, stride, 8);

        gl.drawArrays(gl.TRIANGLES, 0, shadowCount * VERTS_PER_QUAD);

        gl.disableVertexAttribArray(this.aPosition);
        gl.disableVertexAttribArray(this.aUv);
    }

    private ensureInitialized(gl: WebGL2RenderingContext): void {
        if (this.shader) {
            return;
        }

        this.shader = new ShaderProgram();
        this.shader.init(gl);
        this.shader.attachShaders(vertSrc, fragSrc);
        this.shader.create();

        this.aPosition = this.shader.getAttribLocation('a_position');
        this.aUv = this.shader.getAttribLocation('a_uv');
        this.uOpacity = this.shader.getUniformLocation('u_opacity');

        this.buffer = gl.createBuffer();
    }
}

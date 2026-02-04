import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { Entity, EntityType } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { LogHandler } from '@/utilities/log-handler';

import vertCode from './entity-vert.glsl';
import fragCode from './entity-frag.glsl';

// Player colors (RGBA, 0-1 range)
const PLAYER_COLORS = [
    [0.2, 0.6, 1.0, 0.9], // Player 0: Blue
    [1.0, 0.3, 0.3, 0.9], // Player 1: Red
    [0.3, 1.0, 0.3, 0.9], // Player 2: Green
    [1.0, 1.0, 0.3, 0.9] // Player 3: Yellow
];

const SELECTED_COLOR = [1.0, 1.0, 1.0, 1.0]; // White highlight

/**
 * Renders entities (units and buildings) as colored quads on the terrain.
 * Buildings are squares, units are diamonds.
 */
export class EntityRenderer implements IRenderer {
    private static log = new LogHandler('EntityRenderer');

    private gl: WebGLRenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private posBuffer: WebGLBuffer | null = null;

    private mapSize: MapSize;
    private groundHeight: Uint8Array;

    // Entity data to render (set externally each frame)
    public entities: Entity[] = [];
    public selectedEntityId: number | null = null;

    // Cached attribute/uniform locations
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;
    private uProjection: WebGLUniformLocation | null = null;

    constructor(mapSize: MapSize, groundHeight: Uint8Array) {
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
    }

    public async init(gl: WebGLRenderingContext): Promise<boolean> {
        this.gl = gl;

        // Compile shaders
        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vertCode);
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fragCode);
        if (!vs || !fs) return false;

        const program = gl.createProgram();
        if (!program) return false;

        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            EntityRenderer.log.error('Shader link error: ' + gl.getProgramInfoLog(program));
            return false;
        }

        this.program = program;

        // Get locations
        this.aPosition = gl.getAttribLocation(program, 'a_position');
        this.aEntityPos = gl.getAttribLocation(program, 'a_entityPos');
        this.aColor = gl.getAttribLocation(program, 'a_color');
        this.uProjection = gl.getUniformLocation(program, 'projection');

        // Create static quad vertex buffer (two triangles forming a square)
        this.posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -0.5, -0.5,
            0.5, -0.5,
            -0.5, 0.5,
            -0.5, 0.5,
            0.5, -0.5,
            0.5, 0.5
        ]), gl.STATIC_DRAW);

        return true;
    }

    public draw(gl: WebGLRenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.program || this.entities.length === 0) return;

        gl.useProgram(this.program);

        // Enable blending for semi-transparent entities
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Set projection
        gl.uniformMatrix4fv(this.uProjection, false, projection);

        // Draw each entity as a quad
        for (const entity of this.entities) {
            const worldPos = TilePicker.tileToWorld(
                entity.x, entity.y,
                this.groundHeight,
                this.mapSize,
                viewPoint.x, viewPoint.y
            );

            const isSelected = entity.id === this.selectedEntityId;
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
            const color = isSelected ? SELECTED_COLOR : playerColor;

            // Adjust quad size based on entity type
            const scale = entity.type === EntityType.Building ? 0.5 : 0.3;

            this.drawQuad(gl, worldPos.worldX, worldPos.worldY, scale, color, isSelected);
        }

        gl.disable(gl.BLEND);
    }

    private drawQuad(
        gl: WebGLRenderingContext,
        worldX: number,
        worldY: number,
        scale: number,
        color: number[],
        highlighted: boolean
    ): void {
        // Build vertex data for this entity's quad
        const verts = new Float32Array(6 * 2); // 6 vertices, 2 components each
        const baseQuad = [
            -0.5, -0.5,
            0.5, -0.5,
            -0.5, 0.5,
            -0.5, 0.5,
            0.5, -0.5,
            0.5, 0.5
        ];

        for (let i = 0; i < 6; i++) {
            verts[i * 2] = baseQuad[i * 2] * scale + worldX;
            verts[i * 2 + 1] = baseQuad[i * 2 + 1] * scale + worldY;
        }

        // Position attribute
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Entity position (constant per-vertex)
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.vertexAttrib2f(this.aEntityPos, 0, 0);

        // Color (constant per-vertex)
        gl.disableVertexAttribArray(this.aColor);
        gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Draw selection ring if highlighted
        if (highlighted) {
            const ringVerts = new Float32Array(6 * 2);
            const ringScale = scale * 1.4;
            for (let i = 0; i < 6; i++) {
                ringVerts[i * 2] = baseQuad[i * 2] * ringScale + worldX;
                ringVerts[i * 2 + 1] = baseQuad[i * 2 + 1] * ringScale + worldY;
            }

            gl.bufferData(gl.ARRAY_BUFFER, ringVerts, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, 1.0, 1.0, 0.0, 0.5); // yellow ring
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        gl.deleteBuffer(posBuf);
    }

    private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
        const shader = gl.createShader(type);
        if (!shader) return null;

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            EntityRenderer.log.error('Shader compile error: ' + gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }
}

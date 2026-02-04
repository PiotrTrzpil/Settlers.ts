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
const RING_COLOR = [1.0, 1.0, 0.0, 0.5]; // Yellow selection ring

// eslint-disable-next-line no-multi-spaces
const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

const BUILDING_SCALE = 0.5;
const UNIT_SCALE = 0.3;
const RING_SCALE_FACTOR = 1.4;

/**
 * Renders entities (units and buildings) as colored quads on the terrain.
 * Buildings are squares, units are diamonds.
 */
export class EntityRenderer implements IRenderer {
    private static log = new LogHandler('EntityRenderer');

    private gl: WebGLRenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private dynamicBuffer: WebGLBuffer | null = null;

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

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

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

        // Create a single reusable dynamic buffer
        this.dynamicBuffer = gl.createBuffer();

        return true;
    }

    public draw(gl: WebGLRenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.program || !this.dynamicBuffer || this.entities.length === 0) return;

        gl.useProgram(this.program);

        // Enable blending for semi-transparent entities
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Set projection
        gl.uniformMatrix4fv(this.uProjection, false, projection);

        // Bind the reusable buffer once
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Entity position not used (constant zero)
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.vertexAttrib2f(this.aEntityPos, 0, 0);

        // Color set per-entity as constant attribute
        gl.disableVertexAttribArray(this.aColor);

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
            const scale = entity.type === EntityType.Building ? BUILDING_SCALE : UNIT_SCALE;

            // Fill reusable vertex buffer
            this.fillQuadVertices(worldPos.worldX, worldPos.worldY, scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Draw selection ring if highlighted
            if (isSelected) {
                this.fillQuadVertices(worldPos.worldX, worldPos.worldY, scale * RING_SCALE_FACTOR);
                gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
                gl.vertexAttrib4f(this.aColor, RING_COLOR[0], RING_COLOR[1], RING_COLOR[2], RING_COLOR[3]);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }

        gl.disable(gl.BLEND);
    }

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale + worldY;
        }
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

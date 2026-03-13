import type { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TileCoord } from '../entity';
import { PlacementStatus } from '../systems/placement';
import { ShaderProgram } from './shader-program';
import type { ValidPositionGrid, ValidPositionEntry } from '../systems/placement/valid-position-grid';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

// Re-export PlacementStatus for backward compatibility
export { PlacementStatus } from '../systems/placement';

/**
 * Color mapping for non-buildable statuses (RGBA, 0-1 range).
 */
const UNBUILDABLE_COLORS: Record<number, number[]> = {
    [PlacementStatus.InvalidTerrain]: [0.3, 0.0, 0.0, 0.9], // Very dark red - can't build
    [PlacementStatus.Occupied]: [0.4, 0.0, 0.1, 0.9], // Dark red - occupied
    [PlacementStatus.TooSteep]: [0.5, 0.0, 0.1, 0.9], // Dark cherry - too steep
};

/**
 * 10-color gradient from deep green (flat) to deep cherry (steep).
 * Index 0 = flattest (deep green), Index 9 = steepest buildable (deep cherry/red).
 * Weighted toward green — most buildable terrain should look green/yellow.
 */
const SLOPE_GRADIENT: number[][] = [
    [0.0, 0.5, 0.1, 0.9], // 0: Deep forest green - perfectly flat
    [0.0, 0.6, 0.1, 0.9], // 1: Forest green
    [0.0, 0.7, 0.1, 0.9], // 2: Dark green
    [0.1, 0.75, 0.1, 0.9], // 3: Green
    [0.2, 0.8, 0.0, 0.9], // 4: Bright green
    [0.4, 0.8, 0.0, 0.9], // 5: Yellow-green
    [0.6, 0.7, 0.0, 0.9], // 6: Olive/yellow
    [0.8, 0.5, 0.0, 0.9], // 7: Gold/orange
    [0.9, 0.3, 0.0, 0.9], // 8: Orange-red
    [0.7, 0.1, 0.1, 0.9], // 9: Deep cherry - steepest buildable
];

/** Legacy STATUS_COLORS for compatibility with tests */
const STATUS_COLORS: Record<PlacementStatus, number[]> = {
    [PlacementStatus.InvalidTerrain]: UNBUILDABLE_COLORS[PlacementStatus.InvalidTerrain]!,
    [PlacementStatus.Occupied]: UNBUILDABLE_COLORS[PlacementStatus.Occupied]!,
    [PlacementStatus.TooSteep]: UNBUILDABLE_COLORS[PlacementStatus.TooSteep]!,
    [PlacementStatus.Difficult]: SLOPE_GRADIENT[8]!,
    [PlacementStatus.Medium]: SLOPE_GRADIENT[5]!,
    [PlacementStatus.Easy]: SLOPE_GRADIENT[0]!,
    [PlacementStatus.OutOfTerritory]: UNBUILDABLE_COLORS[PlacementStatus.InvalidTerrain]!,
};

// Hover highlight - brighter version
const HOVER_COLOR = [1.0, 1.0, 1.0, 0.9];
const HOVER_RING_COLOR = [1.0, 1.0, 0.3, 0.7];

// Indicator dot size (shader multiplies by 0.4, so effective size = scale * 0.4)
const INDICATOR_DOT_SCALE = 0.4;
const HOVER_DOT_SCALE = 0.5;
const HOVER_RING_SCALE = 0.6;

// Maximum indicators to batch (6 vertices * 8 floats per vertex)
const MAX_BATCH_INDICATORS = 2000;
const FLOATS_PER_INDICATOR = 6 * 8; // 6 vertices, 8 floats each (offsetX, offsetY, entityX, entityY, r, g, b, a)

/**
 * Check if a placement status allows building (shows an indicator).
 * Only Easy, Medium, and Difficult statuses show indicators.
 * Invalid tiles (terrain, occupied, steep) show NO indicator.
 */
export function isBuildableStatus(status: PlacementStatus): boolean {
    return status === PlacementStatus.Easy || status === PlacementStatus.Medium || status === PlacementStatus.Difficult;
}

/**
 * Renders building placement indicators across the visible terrain.
 * Shows colored dots indicating where buildings can be placed and the
 * relative difficulty (based on slope/terrain).
 */
export class BuildingIndicatorRenderer implements IRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private shaderProgram: ShaderProgram | null = null;
    private dynamicBuffer: WebGLBuffer | null = null;

    private mapSize: MapSize;
    private groundHeight: Uint8Array;

    // Cached attribute locations
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Batched vertex buffer (x, y, r, g, b, a per vertex, 6 vertices per quad)
    private batchBuffer: Float32Array = new Float32Array(MAX_BATCH_INDICATORS * FLOATS_PER_INDICATOR);
    private batchCount = 0;

    // State set per-frame by the glue layer
    private enabled = false;
    private hoveredTile: TileCoord | null = null;
    private grid: ValidPositionGrid | null = null;
    private maxSlopeDiff: number = 8;

    constructor(mapSize: MapSize, groundHeight: Uint8Array) {
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
    }

    /**
     * Update per-frame state from the glue layer.
     * Call before draw() each frame.
     */
    public setState(
        indicatorsEnabled: boolean,
        grid: ValidPositionGrid | null,
        hoveredTile: TileCoord | null,
        maxSlopeDiff: number
    ): void {
        this.enabled = indicatorsEnabled;
        this.grid = grid;
        this.hoveredTile = hoveredTile;
        this.maxSlopeDiff = maxSlopeDiff;
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- IRenderer interface requires Promise
    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        this.gl = gl;

        this.shaderProgram = new ShaderProgram();
        this.shaderProgram.init(gl);
        this.shaderProgram.attachShaders(vertCode, fragCode);
        this.shaderProgram.create();

        this.aPosition = this.shaderProgram.getAttribLocation('a_position');
        this.aEntityPos = this.shaderProgram.getAttribLocation('a_entityPos');
        this.aColor = this.shaderProgram.getAttribLocation('a_color');

        this.dynamicBuffer = gl.createBuffer();
        return true;
    }

    /**
     * Clean up WebGL resources.
     */
    public destroy(): void {
        const gl = this.gl;
        if (!gl) {
            return;
        }

        if (this.dynamicBuffer) {
            gl.deleteBuffer(this.dynamicBuffer);
            this.dynamicBuffer = null;
        }

        this.shaderProgram?.free();
        this.shaderProgram = null;
    }

    /**
     * Get gradient color based on height range.
     * Maps height range 0 to maxSlopeDiff onto the 10-color gradient.
     */
    private getGradientColor(heightRange: number): number[] {
        const normalizedSlope = Math.min(heightRange / this.maxSlopeDiff, 1.0);
        const index = Math.min(Math.floor(normalizedSlope * 10), 9);
        return SLOPE_GRADIENT[index]!;
    }

    /**
     * Draw building placement indicators using batched rendering.
     * Reads positions from the ValidPositionGrid — no self-computed validation.
     */
    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.enabled || !this.shaderProgram || !this.dynamicBuffer || !this.grid) {
            return;
        }

        const positions = this.grid.getPositions();
        if (positions.length === 0) {
            return;
        }

        // Setup shader
        this.shaderProgram.use();
        this.shaderProgram.setMatrix('projection', projection);

        this.batchCount = 0;
        this.batchPositions(positions, viewPoint);

        if (this.batchCount === 0) {
            return;
        }

        this.uploadAndDraw(gl);
    }

    /** Batch visible positions into the vertex buffer with frustum culling. */
    private batchPositions(positions: readonly ValidPositionEntry[], viewPoint: IViewPoint): void {
        const visibleWorldRange = 2 / viewPoint.zoom;
        const visibleWidth = Math.ceil(visibleWorldRange * viewPoint.aspectRatio) + 10;
        const visibleHeight = Math.ceil(visibleWorldRange * 2) + 10;
        const centerX = Math.round(viewPoint.x);
        const centerY = Math.round(viewPoint.y);
        const minX = centerX - visibleWidth;
        const maxX = centerX + visibleWidth;
        const minY = centerY - visibleHeight;
        const maxY = centerY + visibleHeight;

        for (const pos of positions) {
            if (this.batchCount >= MAX_BATCH_INDICATORS) {
                break;
            }
            if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
                continue;
            }

            const isHovered = this.hoveredTile && this.hoveredTile.x === pos.x && this.hoveredTile.y === pos.y;
            const worldPos = TilePicker.tileToWorld(
                pos.x,
                pos.y,
                this.groundHeight,
                this.mapSize,
                viewPoint.x,
                viewPoint.y
            );

            const color = isHovered ? HOVER_COLOR : this.getGradientColor(pos.heightRange);
            const scale = isHovered ? HOVER_DOT_SCALE : INDICATOR_DOT_SCALE;
            this.addQuadToBatch(worldPos.worldX, worldPos.worldY, scale, color);

            if (isHovered && this.batchCount < MAX_BATCH_INDICATORS) {
                this.addQuadToBatch(worldPos.worldX, worldPos.worldY, HOVER_RING_SCALE, HOVER_RING_COLOR);
            }
        }
    }

    /** Upload batch buffer to GPU and issue the draw call. */
    private uploadAndDraw(gl: WebGL2RenderingContext): void {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            this.batchBuffer.subarray(0, this.batchCount * FLOATS_PER_INDICATOR),
            gl.DYNAMIC_DRAW
        );

        const stride = 8 * 4;
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.aEntityPos);
        gl.vertexAttribPointer(this.aEntityPos, 2, gl.FLOAT, false, stride, 2 * 4);
        gl.enableVertexAttribArray(this.aColor);
        gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 4 * 4);

        gl.drawArrays(gl.TRIANGLES, 0, this.batchCount * 6);

        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);
    }

    /**
     * Add a quad to the batch buffer.
     * Vertex format: offsetX, offsetY, entityX, entityY, r, g, b, a
     */
    private addQuadToBatch(worldX: number, worldY: number, scale: number, color: number[]): void {
        const offset = this.batchCount * FLOATS_PER_INDICATOR;
        const halfScale = scale * 0.5;

        // 6 vertices for 2 triangles - quad offsets relative to entity center
        // Shader multiplies offsets by 0.4, so we compensate by dividing halfScale
        const adjHalfScale = halfScale / 0.4;
        const quadOffsets = [
            -adjHalfScale,
            -adjHalfScale,
            adjHalfScale,
            -adjHalfScale,
            -adjHalfScale,
            adjHalfScale,
            -adjHalfScale,
            adjHalfScale,
            adjHalfScale,
            -adjHalfScale,
            adjHalfScale,
            adjHalfScale,
        ];

        for (let i = 0; i < 6; i++) {
            const vertOffset = offset + i * 8;
            // Quad offset (a_position)
            this.batchBuffer[vertOffset] = quadOffsets[i * 2]!;
            this.batchBuffer[vertOffset + 1] = quadOffsets[i * 2 + 1]!;
            // Entity world position (a_entityPos)
            this.batchBuffer[vertOffset + 2] = worldX;
            this.batchBuffer[vertOffset + 3] = worldY;
            // Color (a_color)
            this.batchBuffer[vertOffset + 4] = color[0]!;
            this.batchBuffer[vertOffset + 5] = color[1]!;
            this.batchBuffer[vertOffset + 6] = color[2]!;
            this.batchBuffer[vertOffset + 7] = color[3]!;
        }

        this.batchCount++;
    }

    /**
     * Get the color for a placement status (for UI display).
     */
    public static getStatusColor(status: PlacementStatus): number[] {
        return STATUS_COLORS[status];
    }

    /**
     * Get human-readable description of a placement status.
     */
    public static getStatusDescription(status: PlacementStatus): string {
        switch (status) {
            case PlacementStatus.InvalidTerrain:
                return 'Cannot build: Invalid terrain';
            case PlacementStatus.Occupied:
                return 'Cannot build: Occupied';
            case PlacementStatus.TooSteep:
                return 'Cannot build: Too steep';
            case PlacementStatus.Difficult:
                return 'Can build: Uneven terrain';
            case PlacementStatus.Medium:
                return 'Can build: Slight slope';
            case PlacementStatus.Easy:
                return 'Can build: Flat terrain';
            case PlacementStatus.OutOfTerritory:
                return 'Cannot build: Outside territory';
        }
    }
}

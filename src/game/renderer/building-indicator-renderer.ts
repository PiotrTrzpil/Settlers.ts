import { IViewPoint } from './i-view-point';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TileCoord, tileKey, BuildingType, getBuildingFootprint } from '../entity';
import { isBuildable, PlacementStatus, MAX_SLOPE_DIFF } from '../features/placement';
import { ShaderProgram } from './shader-program';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

// Re-export PlacementStatus for backward compatibility
export { PlacementStatus } from '../features/placement';

/**
 * Color mapping for placement indicators (RGBA, 0-1 range).
 * Green = good, Yellow = medium, Red = bad.
 */
const STATUS_COLORS: Record<PlacementStatus, number[]> = {
    [PlacementStatus.InvalidTerrain]: [0.6, 0.1, 0.1, 0.8],     // Dark red
    [PlacementStatus.Occupied]: [0.7, 0.2, 0.2, 0.8],           // Red
    [PlacementStatus.TooSteep]: [0.9, 0.3, 0.1, 0.8],           // Dark orange
    [PlacementStatus.Difficult]: [0.9, 0.7, 0.1, 0.8],          // Yellow-orange
    [PlacementStatus.Medium]: [0.7, 0.9, 0.2, 0.8],             // Yellow-green
    [PlacementStatus.Easy]: [0.2, 0.9, 0.3, 0.8],               // Green
};

// Hover highlight - brighter version
const HOVER_COLOR = [1.0, 1.0, 1.0, 0.9];
const HOVER_RING_COLOR = [1.0, 1.0, 0.3, 0.7];

// Indicator dot size (shader multiplies by 0.4, so effective size = scale * 0.4)
const INDICATOR_DOT_SCALE = 0.4;
const HOVER_DOT_SCALE = 0.5;
const HOVER_RING_SCALE = 0.6;

// Maximum indicators to batch (6 vertices * 6 floats per vertex)
const MAX_BATCH_INDICATORS = 2000;
const FLOATS_PER_INDICATOR = 6 * 6; // 6 vertices, 6 floats each (x, y, r, g, b, a)

/**
 * Check if a placement status allows building (shows an indicator).
 * Only Easy, Medium, and Difficult statuses show indicators.
 * Invalid tiles (terrain, occupied, steep) show NO indicator.
 */
export function isBuildableStatus(status: PlacementStatus): boolean {
    return status === PlacementStatus.Easy ||
           status === PlacementStatus.Medium ||
           status === PlacementStatus.Difficult;
}

/**
 * Renders building placement indicators across the visible terrain.
 * Shows colored dots indicating where buildings can be placed and the
 * relative difficulty (based on slope/terrain).
 */
export class BuildingIndicatorRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private shaderProgram: ShaderProgram | null = null;
    private dynamicBuffer: WebGLBuffer | null = null;

    private mapSize: MapSize;
    private groundType: Uint8Array;
    private groundHeight: Uint8Array;

    // Cached attribute locations
    private aPosition = -1;
    private aColor = -1;

    // Batched vertex buffer (x, y, r, g, b, a per vertex, 6 vertices per quad)
    private batchBuffer: Float32Array = new Float32Array(MAX_BATCH_INDICATORS * FLOATS_PER_INDICATOR);
    private batchCount = 0;

    // Cached indicator data with numeric coords (avoid string parsing in draw loop)
    private indicatorCache: Array<{ x: number; y: number; status: PlacementStatus }> = [];
    private cacheViewX = 0;
    private cacheViewY = 0;
    private cacheZoom = 0;
    private cacheBuildingType: BuildingType | null = null;

    // Public state - set by use-renderer
    public enabled = false;
    public hoveredTile: TileCoord | null = null;
    public buildingType: BuildingType | null = null;

    // External dependencies
    public tileOccupancy: Map<string, number> = new Map();

    constructor(
        mapSize: MapSize,
        groundType: Uint8Array,
        groundHeight: Uint8Array
    ) {
        this.mapSize = mapSize;
        this.groundType = groundType;
        this.groundHeight = groundHeight;
    }

    /**
     * Initialize WebGL resources.
     */
    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;

        this.shaderProgram = new ShaderProgram();
        this.shaderProgram.init(gl);
        this.shaderProgram.attachShaders(vertCode, fragCode);
        this.shaderProgram.create();

        this.aPosition = this.shaderProgram.getAttribLocation('a_position');
        this.aColor = this.shaderProgram.getAttribLocation('a_color');

        this.dynamicBuffer = gl.createBuffer();
    }

    /**
     * Clean up WebGL resources.
     */
    public destroy(): void {
        const gl = this.gl;
        if (!gl) return;

        if (this.dynamicBuffer) {
            gl.deleteBuffer(this.dynamicBuffer);
            this.dynamicBuffer = null;
        }

        this.shaderProgram?.free();
        this.shaderProgram = null;
    }

    /** Check if footprint is within map bounds */
    private isFootprintInBounds(footprint: TileCoord[]): boolean {
        return footprint.every(t =>
            t.x >= 0 && t.x < this.mapSize.width && t.y >= 0 && t.y < this.mapSize.height
        );
    }

    /** Check individual tile for basic placement requirements */
    private checkTileBasics(tile: TileCoord): PlacementStatus | null {
        const idx = this.mapSize.toIndex(tile.x, tile.y);
        if (!isBuildable(this.groundType[idx])) return PlacementStatus.InvalidTerrain;
        if (this.tileOccupancy.has(tileKey(tile.x, tile.y))) return PlacementStatus.Occupied;
        return null;
    }

    /** Compute slope difficulty rating */
    private computeSlopeDifficulty(footprint: TileCoord[]): PlacementStatus {
        let minHeight = 255, maxHeight = 0;
        for (const tile of footprint) {
            const h = this.groundHeight[this.mapSize.toIndex(tile.x, tile.y)];
            minHeight = Math.min(minHeight, h);
            maxHeight = Math.max(maxHeight, h);
        }

        const heightDiff = maxHeight - minHeight;
        if (heightDiff > MAX_SLOPE_DIFF) return PlacementStatus.TooSteep;
        if (heightDiff === 0) return PlacementStatus.Easy;
        if (heightDiff === 1) return PlacementStatus.Medium;
        return PlacementStatus.Difficult;
    }

    /**
     * Compute placement status for placing a building with top-left at (x, y).
     * Checks the entire building footprint.
     */
    public computePlacementStatus(x: number, y: number): PlacementStatus {
        if (this.buildingType === null) return PlacementStatus.InvalidTerrain;

        const footprint = getBuildingFootprint(x, y, this.buildingType);

        if (!this.isFootprintInBounds(footprint)) return PlacementStatus.InvalidTerrain;

        for (const tile of footprint) {
            const issue = this.checkTileBasics(tile);
            if (issue !== null) return issue;
        }

        return this.computeSlopeDifficulty(footprint);
    }

    /**
     * Check if cache is still valid.
     */
    private isCacheValid(viewPoint: IViewPoint): boolean {
        const viewDist = Math.abs(viewPoint.x - this.cacheViewX) +
                        Math.abs(viewPoint.y - this.cacheViewY);
        const zoomDiff = Math.abs(viewPoint.zoom - this.cacheZoom);

        return viewDist < 5 &&
               zoomDiff < 0.01 &&
               this.buildingType === this.cacheBuildingType;
    }

    /**
     * Rebuild the indicator cache for visible tiles.
     * Only stores buildable tiles to minimize draw loop iterations.
     */
    private rebuildCache(viewPoint: IViewPoint): void {
        this.indicatorCache.length = 0;

        // Compute visible tile range based on viewport
        // zoom = 0.1 / zoomValue, so smaller zoom = more zoomed out = larger visible area
        // zoomValue = 0.1 / zoom
        const zoomValue = 0.1 / viewPoint.zoom;
        const visibleWidth = Math.ceil(40 / zoomValue);
        const visibleHeight = Math.ceil(30 / zoomValue);

        const centerX = Math.round(viewPoint.x);
        const centerY = Math.round(viewPoint.y);

        const minX = Math.max(0, centerX - visibleWidth);
        const maxX = Math.min(this.mapSize.width - 1, centerX + visibleWidth);
        const minY = Math.max(0, centerY - visibleHeight);
        const maxY = Math.min(this.mapSize.height - 1, centerY + visibleHeight);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const status = this.computePlacementStatus(x, y);
                // Only store buildable tiles (skip invalid ones entirely)
                if (isBuildableStatus(status)) {
                    this.indicatorCache.push({ x, y, status });
                }
            }
        }

        // Update cache metadata
        this.cacheViewX = viewPoint.x;
        this.cacheViewY = viewPoint.y;
        this.cacheZoom = viewPoint.zoom;
        this.cacheBuildingType = this.buildingType;
    }

    /**
     * Draw building placement indicators using batched rendering.
     */
    public draw(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint
    ): void {
        if (!this.enabled || !this.shaderProgram || !this.dynamicBuffer) {
            return;
        }

        // Rebuild cache if needed
        if (!this.isCacheValid(viewPoint)) {
            this.rebuildCache(viewPoint);
        }

        if (this.indicatorCache.length === 0) {
            return;
        }

        // Setup shader
        this.shaderProgram.use();
        this.shaderProgram.setMatrix('projection', projection);

        // Build batched vertex data
        this.batchCount = 0;

        for (const indicator of this.indicatorCache) {
            if (this.batchCount >= MAX_BATCH_INDICATORS) break;

            const { x, y, status } = indicator;

            const isHovered = this.hoveredTile &&
                              this.hoveredTile.x === x &&
                              this.hoveredTile.y === y;

            const worldPos = TilePicker.tileToWorld(
                x, y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            const color = isHovered ? HOVER_COLOR : STATUS_COLORS[status];
            const scale = isHovered ? HOVER_DOT_SCALE : INDICATOR_DOT_SCALE;

            this.addQuadToBatch(worldPos.worldX, worldPos.worldY, scale, color);

            // Add hover ring as additional quad
            if (isHovered && this.batchCount < MAX_BATCH_INDICATORS) {
                this.addQuadToBatch(worldPos.worldX, worldPos.worldY, HOVER_RING_SCALE, HOVER_RING_COLOR);
            }
        }

        if (this.batchCount === 0) return;

        // Upload and draw all indicators in one call
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.batchBuffer.subarray(0, this.batchCount * FLOATS_PER_INDICATOR), gl.DYNAMIC_DRAW);

        // Position attribute: 2 floats at offset 0, stride 6 floats
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 6 * 4, 0);

        // Color attribute: 4 floats at offset 2, stride 6 floats
        gl.enableVertexAttribArray(this.aColor);
        gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, 6 * 4, 2 * 4);

        gl.drawArrays(gl.TRIANGLES, 0, this.batchCount * 6);

        gl.disableVertexAttribArray(this.aColor);
    }

    /**
     * Add a quad to the batch buffer.
     */
    private addQuadToBatch(worldX: number, worldY: number, scale: number, color: number[]): void {
        const offset = this.batchCount * FLOATS_PER_INDICATOR;
        const halfScale = scale * 0.5;

        // 6 vertices for 2 triangles (x, y, r, g, b, a per vertex)
        const positions = [
            worldX - halfScale, worldY - halfScale,
            worldX + halfScale, worldY - halfScale,
            worldX - halfScale, worldY + halfScale,
            worldX - halfScale, worldY + halfScale,
            worldX + halfScale, worldY - halfScale,
            worldX + halfScale, worldY + halfScale,
        ];

        for (let i = 0; i < 6; i++) {
            const vertOffset = offset + i * 6;
            this.batchBuffer[vertOffset] = positions[i * 2];
            this.batchBuffer[vertOffset + 1] = positions[i * 2 + 1];
            this.batchBuffer[vertOffset + 2] = color[0];
            this.batchBuffer[vertOffset + 3] = color[1];
            this.batchBuffer[vertOffset + 4] = color[2];
            this.batchBuffer[vertOffset + 5] = color[3];
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
        }
    }

    /**
     * Invalidate cache to force recalculation.
     */
    public invalidateCache(): void {
        this.indicatorCache.length = 0;
    }
}

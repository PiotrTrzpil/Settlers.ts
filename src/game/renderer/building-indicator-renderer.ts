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

// Base quad for dot rendering
const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

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
    private aEntityPos = -1;
    private aColor = -1;

    // Reusable vertex buffer
    private vertexData = new Float32Array(6 * 2);

    // Cached indicator data (recomputed when viewport changes significantly)
    private indicatorCache: Map<string, PlacementStatus> = new Map();
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
        this.aEntityPos = this.shaderProgram.getAttribLocation('a_entityPos');
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
     */
    private rebuildCache(viewPoint: IViewPoint): void {
        this.indicatorCache.clear();

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
                this.indicatorCache.set(tileKey(x, y), status);
            }
        }

        // Update cache metadata
        this.cacheViewX = viewPoint.x;
        this.cacheViewY = viewPoint.y;
        this.cacheZoom = viewPoint.zoom;
        this.cacheBuildingType = this.buildingType;
    }

    /**
     * Draw building placement indicators.
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

        // Setup shader
        this.shaderProgram.use();
        this.shaderProgram.setMatrix('projection', projection);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        // Draw only buildable indicators (skip invalid tiles - no dot shown)
        for (const [key, status] of this.indicatorCache) {
            // Only show indicators for tiles where building is possible
            if (!isBuildableStatus(status)) {
                continue;
            }

            const [xStr, yStr] = key.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);

            const isHovered = this.hoveredTile &&
                              this.hoveredTile.x === x &&
                              this.hoveredTile.y === y;

            const worldPos = TilePicker.tileToWorld(
                x, y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            // Draw indicator dot
            const color = isHovered ? HOVER_COLOR : STATUS_COLORS[status];
            const scale = isHovered ? HOVER_DOT_SCALE : INDICATOR_DOT_SCALE;

            gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(0, 0, scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Draw hover ring
            if (isHovered) {
                this.fillQuadVertices(0, 0, HOVER_RING_SCALE);
                gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
                gl.vertexAttrib4f(this.aColor,
                    HOVER_RING_COLOR[0], HOVER_RING_COLOR[1],
                    HOVER_RING_COLOR[2], HOVER_RING_COLOR[3]);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /**
     * Fill quad vertices into the vertex buffer.
     */
    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale + worldY;
        }
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
        this.indicatorCache.clear();
    }
}

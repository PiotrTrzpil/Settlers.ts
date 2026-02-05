import { IViewPoint } from './i-view-point';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TileCoord, CARDINAL_OFFSETS, tileKey } from '../entity';
import { TerritoryMap, NO_OWNER } from '../systems/territory';
import { isBuildable, isPassable } from '../systems/placement';
import { ShaderProgram } from './shader-program';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

/**
 * Placement indicator status for a tile.
 */
export enum PlacementStatus {
    /** Cannot place - invalid terrain (water, rock, etc.) */
    InvalidTerrain = 0,
    /** Cannot place - tile is occupied */
    Occupied = 1,
    /** Cannot place - enemy territory */
    EnemyTerritory = 2,
    /** Cannot place - outside territory and not adjacent */
    OutsideTerritory = 3,
    /** Cannot place - slope too steep */
    TooSteep = 4,
    /** Can place - difficult (high slope) */
    Difficult = 5,
    /** Can place - medium difficulty */
    Medium = 6,
    /** Can place - easy (flat terrain) */
    Easy = 7,
}

/**
 * Color mapping for placement indicators (RGBA, 0-1 range).
 * Green = good, Yellow = medium, Red = bad.
 */
const STATUS_COLORS: Record<PlacementStatus, number[]> = {
    [PlacementStatus.InvalidTerrain]: [0.6, 0.1, 0.1, 0.8],     // Dark red
    [PlacementStatus.Occupied]: [0.7, 0.2, 0.2, 0.8],           // Red
    [PlacementStatus.EnemyTerritory]: [0.8, 0.2, 0.4, 0.8],     // Magenta-red
    [PlacementStatus.OutsideTerritory]: [0.7, 0.3, 0.2, 0.8],   // Orange-red
    [PlacementStatus.TooSteep]: [0.9, 0.3, 0.1, 0.8],           // Dark orange
    [PlacementStatus.Difficult]: [0.9, 0.7, 0.1, 0.8],          // Yellow-orange
    [PlacementStatus.Medium]: [0.7, 0.9, 0.2, 0.8],             // Yellow-green
    [PlacementStatus.Easy]: [0.2, 0.9, 0.3, 0.8],               // Green
};

// Hover highlight - brighter version
const HOVER_COLOR = [1.0, 1.0, 1.0, 0.9];
const HOVER_RING_COLOR = [1.0, 1.0, 0.3, 0.7];

// Maximum slope difference for building placement
const MAX_SLOPE_DIFF = 2;

// Indicator dot size
const INDICATOR_DOT_SCALE = 0.08;
const HOVER_DOT_SCALE = 0.12;
const HOVER_RING_SCALE = 0.18;

// Maximum indicators to batch render at once
const MAX_BATCH_INDICATORS = 2000;
const FLOATS_PER_INDICATOR = 6 * 4; // 6 vertices, 4 floats each (x, y, entityX, entityY) - but we use constant attributes

// Base quad for dot rendering
const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

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
    private cacheTerritoryVersion = 0;
    private cachePlayer = -1;
    private cacheHasBuildings = false;

    // Public state - set by use-renderer
    public enabled = false;
    public hoveredTile: TileCoord | null = null;
    public player = 0;
    public hasBuildings = false;

    // External dependencies
    public territory: TerritoryMap | null = null;
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

    /**
     * Compute placement status for a single tile.
     */
    public computePlacementStatus(x: number, y: number): PlacementStatus {
        const idx = this.mapSize.toIndex(x, y);

        // Check terrain type first
        if (!isBuildable(this.groundType[idx])) {
            // Distinguish water/rock from other non-buildable
            if (!isPassable(this.groundType[idx])) {
                return PlacementStatus.InvalidTerrain;
            }
            return PlacementStatus.InvalidTerrain;
        }

        // Check occupancy
        if (this.tileOccupancy.has(tileKey(x, y))) {
            return PlacementStatus.Occupied;
        }

        // Check territory
        if (this.territory && this.hasBuildings) {
            const owner = this.territory.getOwner(x, y);
            if (owner !== this.player && owner !== NO_OWNER) {
                return PlacementStatus.EnemyTerritory;
            }
            // If unclaimed, must be adjacent to own territory
            if (owner === NO_OWNER) {
                let adjacentToOwn = false;
                for (const [dx, dy] of CARDINAL_OFFSETS) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < this.mapSize.width &&
                        ny >= 0 && ny < this.mapSize.height) {
                        if (this.territory.isOwnedBy(nx, ny, this.player)) {
                            adjacentToOwn = true;
                            break;
                        }
                    }
                }
                if (!adjacentToOwn) {
                    return PlacementStatus.OutsideTerritory;
                }
            }
        }

        // Check slope and compute difficulty
        const centerHeight = this.groundHeight[idx];
        let maxSlopeDiff = 0;

        for (const [dx, dy] of CARDINAL_OFFSETS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= this.mapSize.width ||
                ny < 0 || ny >= this.mapSize.height) {
                continue;
            }
            const neighborHeight = this.groundHeight[this.mapSize.toIndex(nx, ny)];
            const diff = Math.abs(centerHeight - neighborHeight);
            maxSlopeDiff = Math.max(maxSlopeDiff, diff);
        }

        if (maxSlopeDiff > MAX_SLOPE_DIFF) {
            return PlacementStatus.TooSteep;
        }

        // Slope-based difficulty rating
        if (maxSlopeDiff === 0) {
            return PlacementStatus.Easy;
        } else if (maxSlopeDiff === 1) {
            return PlacementStatus.Medium;
        } else {
            return PlacementStatus.Difficult;
        }
    }

    /**
     * Check if cache is still valid.
     */
    private isCacheValid(viewPoint: IViewPoint, territoryVersion: number): boolean {
        const viewDist = Math.abs(viewPoint.x - this.cacheViewX) +
                        Math.abs(viewPoint.y - this.cacheViewY);
        const zoomDiff = Math.abs(viewPoint.zoom - this.cacheZoom);

        return viewDist < 5 &&
               zoomDiff < 0.01 &&
               territoryVersion === this.cacheTerritoryVersion &&
               this.player === this.cachePlayer &&
               this.hasBuildings === this.cacheHasBuildings;
    }

    /**
     * Rebuild the indicator cache for visible tiles.
     */
    private rebuildCache(viewPoint: IViewPoint, territoryVersion: number): void {
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
        this.cacheTerritoryVersion = territoryVersion;
        this.cachePlayer = this.player;
        this.cacheHasBuildings = this.hasBuildings;
    }

    /**
     * Draw building placement indicators.
     */
    public draw(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint,
        territoryVersion: number
    ): void {
        if (!this.enabled || !this.shaderProgram || !this.dynamicBuffer) {
            return;
        }

        // Rebuild cache if needed
        if (!this.isCacheValid(viewPoint, territoryVersion)) {
            this.rebuildCache(viewPoint, territoryVersion);
        }

        // Setup shader
        this.shaderProgram.use();
        this.shaderProgram.setMatrix('projection', projection);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        // Draw all indicators
        for (const [key, status] of this.indicatorCache) {
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
            case PlacementStatus.EnemyTerritory:
                return 'Cannot build: Enemy territory';
            case PlacementStatus.OutsideTerritory:
                return 'Cannot build: Outside territory';
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
        this.cacheTerritoryVersion = -1;
    }
}

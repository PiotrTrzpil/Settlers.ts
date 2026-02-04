import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { Entity, EntityType, UnitState, TileCoord, CARDINAL_OFFSETS } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TerritoryMap, NO_OWNER } from '../systems/territory';
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
const PATH_COLOR = [0.3, 1.0, 0.6, 0.4]; // Green path indicator
const PREVIEW_VALID_COLOR = [0.3, 1.0, 0.3, 0.5]; // Green ghost building
const PREVIEW_INVALID_COLOR = [1.0, 0.3, 0.3, 0.5]; // Red ghost building

// eslint-disable-next-line no-multi-spaces
const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

const BUILDING_SCALE = 0.5;
const UNIT_SCALE = 0.3;
const RING_SCALE_FACTOR = 1.4;
const PATH_DOT_SCALE = 0.12;

/**
 * Renders entities (units and buildings) as colored quads on the terrain.
 * Supports smooth unit interpolation, path visualization, and placement preview.
 */
export class EntityRenderer extends RendererBase implements IRenderer {
    private static log = new LogHandler('EntityRenderer');

    private dynamicBuffer: WebGLBuffer | null = null;

    private mapSize: MapSize;
    private groundHeight: Uint8Array;

    // Entity data to render (set externally each frame)
    public entities: Entity[] = [];
    public selectedEntityId: number | null = null;
    public selectedEntityIds: Set<number> = new Set();

    // Unit states for smooth interpolation and path visualization
    public unitStates: Map<number, UnitState> = new Map();

    // Building placement preview
    public previewTile: TileCoord | null = null;
    public previewValid = false;

    // Territory visualization
    public territoryMap: TerritoryMap | null = null;
    private territoryBorderCache: { x: number; y: number; player: number }[] = [];
    private lastTerritoryVersion = -1;
    public territoryVersion = 0;

    // Cached attribute/uniform locations
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

    constructor(mapSize: MapSize, groundHeight: Uint8Array) {
        super();
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
    }

    public async init(gl: WebGLRenderingContext): Promise<boolean> {
        super.initShader(gl, vertCode, fragCode);

        const sp = this.shaderProgram;

        // Get locations
        this.aPosition = sp.getAttribLocation('a_position');
        this.aEntityPos = sp.getAttribLocation('a_entityPos');
        this.aColor = sp.getAttribLocation('a_color');

        // Create a single reusable dynamic buffer
        this.dynamicBuffer = gl.createBuffer();

        return true;
    }

    public draw(gl: WebGLRenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.dynamicBuffer) return;
        if (this.entities.length === 0 && !this.previewTile) return;

        super.drawBase(gl, projection);

        // Enable blending for semi-transparent entities
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Bind the reusable buffer once
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Entity position not used (constant zero)
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.vertexAttrib2f(this.aEntityPos, 0, 0);

        // Color set per-entity as constant attribute
        gl.disableVertexAttribArray(this.aColor);

        // Draw territory borders
        this.drawTerritoryBorders(gl, viewPoint);

        // Draw path indicators for selected unit
        this.drawSelectedUnitPath(gl, viewPoint);

        // Draw each entity as a quad
        for (const entity of this.entities) {
            const isSelected = this.selectedEntityIds.has(entity.id);
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
            const color = isSelected ? SELECTED_COLOR : playerColor;
            const scale = entity.type === EntityType.Building ? BUILDING_SCALE : UNIT_SCALE;

            // Use interpolated position for units, exact position for buildings
            let worldPos: { worldX: number; worldY: number };
            if (entity.type === EntityType.Unit) {
                worldPos = this.getInterpolatedWorldPos(entity, viewPoint);
            } else {
                worldPos = TilePicker.tileToWorld(
                    entity.x, entity.y,
                    this.groundHeight, this.mapSize,
                    viewPoint.x, viewPoint.y
                );
            }

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

        // Draw placement preview
        this.drawPlacementPreview(gl, viewPoint);

        gl.disable(gl.BLEND);
    }

    /** Get the interpolated world position for a unit using lerp between prev and current tile */
    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const unitState = this.unitStates.get(entity.id);

        // No unit state or not moving: use exact position
        if (!unitState || unitState.pathIndex >= unitState.path.length) {
            return TilePicker.tileToWorld(
                entity.x, entity.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );
        }

        const prevPos = TilePicker.tileToWorld(
            unitState.prevX, unitState.prevY,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );
        const currPos = TilePicker.tileToWorld(
            entity.x, entity.y,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );

        // Lerp between previous and current position using moveProgress
        const t = Math.min(unitState.moveProgress, 1);
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t
        };
    }

    /** Draw dots along the remaining path of all selected units */
    private drawSelectedUnitPath(gl: WebGLRenderingContext, viewPoint: IViewPoint): void {
        if (this.selectedEntityIds.size === 0) return;

        gl.vertexAttrib4f(this.aColor, PATH_COLOR[0], PATH_COLOR[1], PATH_COLOR[2], PATH_COLOR[3]);

        for (const entityId of this.selectedEntityIds) {
            const unitState = this.unitStates.get(entityId);
            if (!unitState || unitState.pathIndex >= unitState.path.length) continue;

            // Draw a small dot at each remaining waypoint (max 30 per unit)
            const maxDots = Math.min(unitState.path.length, unitState.pathIndex + 30);
            for (let i = unitState.pathIndex; i < maxDots; i++) {
                const wp = unitState.path[i];
                const worldPos = TilePicker.tileToWorld(
                    wp.x, wp.y,
                    this.groundHeight, this.mapSize,
                    viewPoint.x, viewPoint.y
                );

                this.fillQuadVertices(worldPos.worldX, worldPos.worldY, PATH_DOT_SCALE);
                gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /** Draw a ghost building at the preview tile when in placement mode */
    private drawPlacementPreview(gl: WebGLRenderingContext, viewPoint: IViewPoint): void {
        if (!this.previewTile) return;

        const worldPos = TilePicker.tileToWorld(
            this.previewTile.x, this.previewTile.y,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );

        const color = this.previewValid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        this.fillQuadVertices(worldPos.worldX, worldPos.worldY, BUILDING_SCALE);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /** Draw small markers at territory border tiles */
    private drawTerritoryBorders(gl: WebGLRenderingContext, viewPoint: IViewPoint): void {
        if (!this.territoryMap) return;

        // Rebuild border cache when territory changes
        if (this.lastTerritoryVersion !== this.territoryVersion) {
            this.rebuildBorderCache();
            this.lastTerritoryVersion = this.territoryVersion;
        }

        const BORDER_SCALE = 0.15;
        const BORDER_ALPHA = 0.35;

        for (const border of this.territoryBorderCache) {
            const worldPos = TilePicker.tileToWorld(
                border.x, border.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            const playerColor = PLAYER_COLORS[border.player % PLAYER_COLORS.length];
            this.fillQuadVertices(worldPos.worldX, worldPos.worldY, BORDER_SCALE);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, playerColor[0], playerColor[1], playerColor[2], BORDER_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /** Compute which tiles are on a territory border (owned with a differently-owned neighbor) */
    private rebuildBorderCache(): void {
        this.territoryBorderCache = [];
        if (!this.territoryMap) return;

        const w = this.mapSize.width;
        const h = this.mapSize.height;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const owner = this.territoryMap.getOwner(x, y);
                if (owner === NO_OWNER) continue;

                // Check if this is a border tile
                let isBorder = false;
                for (const [dx, dy] of CARDINAL_OFFSETS) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                        isBorder = true;
                        break;
                    }
                    if (this.territoryMap.getOwner(nx, ny) !== owner) {
                        isBorder = true;
                        break;
                    }
                }

                if (isBorder) {
                    this.territoryBorderCache.push({ x, y, player: owner });
                }
            }
        }
    }

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale + worldY;
        }
    }
}

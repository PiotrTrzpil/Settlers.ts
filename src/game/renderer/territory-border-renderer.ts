import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TerritoryMap, NO_OWNER } from '../buildings/territory';
import { CARDINAL_OFFSETS } from '../entity';
import { IViewPoint } from './i-view-point';

// Player colors (RGBA, 0-1 range) - shared with EntityRenderer
const PLAYER_COLORS = [
    [0.2, 0.6, 1.0, 0.9], // Player 0: Blue
    [1.0, 0.3, 0.3, 0.9], // Player 1: Red
    [0.3, 1.0, 0.3, 0.9], // Player 2: Green
    [1.0, 1.0, 0.3, 0.9] // Player 3: Yellow
];

const BORDER_SCALE = 0.15;
const BORDER_ALPHA = 0.35;

// Base quad vertices for a unit square centered at origin
const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

interface BorderTile {
    x: number;
    y: number;
    player: number;
}

/**
 * Renders territory border markers as small colored quads.
 * Extracted from EntityRenderer to separate concerns.
 */
export class TerritoryBorderRenderer {
    private mapSize: MapSize;
    private groundHeight: Uint8Array;

    private borderCache: BorderTile[] = [];
    private lastTerritoryVersion = -1;

    // Reusable vertex buffer
    private vertexData = new Float32Array(6 * 2);

    constructor(mapSize: MapSize, groundHeight: Uint8Array) {
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
    }

    /**
     * Draw territory border markers using the color shader.
     * Assumes the shader is already active and buffer is bound.
     */
    public draw(
        gl: WebGL2RenderingContext,
        viewPoint: IViewPoint,
        territoryMap: TerritoryMap | null,
        territoryVersion: number,
        aEntityPos: number,
        aColor: number
    ): void {
        if (!territoryMap) return;

        // Rebuild cache when territory changes
        if (this.lastTerritoryVersion !== territoryVersion) {
            this.rebuildBorderCache(territoryMap);
            this.lastTerritoryVersion = territoryVersion;
        }

        for (const border of this.borderCache) {
            const worldPos = TilePicker.tileToWorld(
                border.x, border.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            const playerColor = PLAYER_COLORS[border.player % PLAYER_COLORS.length];
            gl.vertexAttrib2f(aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(BORDER_SCALE);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(aColor, playerColor[0], playerColor[1], playerColor[2], BORDER_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /**
     * Compute which tiles are on a territory border (owned with a differently-owned neighbor).
     */
    private rebuildBorderCache(territoryMap: TerritoryMap): void {
        this.borderCache = [];

        const w = this.mapSize.width;
        const h = this.mapSize.height;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const owner = territoryMap.getOwner(x, y);
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
                    if (territoryMap.getOwner(nx, ny) !== owner) {
                        isBorder = true;
                        break;
                    }
                }

                if (isBorder) {
                    this.borderCache.push({ x, y, player: owner });
                }
            }
        }
    }

    private fillQuadVertices(scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale;
        }
    }
}

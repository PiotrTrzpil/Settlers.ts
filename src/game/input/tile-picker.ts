import { TileCoord } from '../entity';
import { IViewPointReadonly } from '../renderer/i-view-point';
import { MapSize } from '@/utilities/map-size';
import {
    screenToTile,
    tileToWorld,
    heightToWorld,
} from '../systems/coordinate-system';

/**
 * TilePicker - Thin wrapper around coordinate-system functions.
 *
 * Provides the interface expected by InputManager while delegating
 * all math to the pure functions in coordinate-system.ts.
 */
export class TilePicker {
    private canvas: HTMLCanvasElement;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    /**
     * Convert a canvas pixel position to a tile coordinate.
     */
    public screenToTile(
        screenX: number,
        screenY: number,
        viewPoint: IViewPointReadonly,
        mapSize: MapSize,
        groundHeight: Uint8Array
    ): TileCoord | null {
        return screenToTile({
            screenX,
            screenY,
            canvasWidth: this.canvas.clientWidth,
            canvasHeight: this.canvas.clientHeight,
            zoom: viewPoint.zoom,
            viewPointX: viewPoint.x,
            viewPointY: viewPoint.y,
            mapWidth: mapSize.width,
            mapHeight: mapSize.height,
            groundHeight,
        });
    }

    /**
     * Convert tile coordinate to world position (for rendering entities).
     * Static method for use without a TilePicker instance.
     */
    public static tileToWorld(
        tileX: number,
        tileY: number,
        groundHeight: Uint8Array,
        mapSize: MapSize,
        viewPointX: number,
        viewPointY: number
    ): { worldX: number; worldY: number } {
        const idx = mapSize.toIndex(tileX, tileY);
        const hWorld = heightToWorld(groundHeight[idx]);
        return tileToWorld(tileX, tileY, hWorld, viewPointX, viewPointY);
    }
}

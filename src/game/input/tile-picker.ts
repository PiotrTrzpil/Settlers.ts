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
     *
     * NOTE: This method only works with integer tile coordinates.
     * For fractional coordinates, use the pure tileToWorld() function
     * from coordinate-system.ts with a pre-calculated height.
     */
    public static tileToWorld(
        tileX: number,
        tileY: number,
        groundHeight: Uint8Array,
        mapSize: MapSize,
        viewPointX: number,
        viewPointY: number
    ): { worldX: number; worldY: number } {
        // Validate tile coordinates are integers and in bounds
        const intX = Math.floor(tileX);
        const intY = Math.floor(tileY);

        if (intX < 0 || intX >= mapSize.width || intY < 0 || intY >= mapSize.height) {
            console.warn(`TilePicker.tileToWorld: tile (${tileX}, ${tileY}) out of bounds [0-${mapSize.width}, 0-${mapSize.height}]`);
            // Return a default position to avoid NaN
            return tileToWorld(tileX, tileY, 0, viewPointX, viewPointY);
        }

        if (tileX !== intX || tileY !== intY) {
            console.warn(`TilePicker.tileToWorld: fractional coordinates (${tileX}, ${tileY}) - use pure tileToWorld() instead`);
        }

        const idx = mapSize.toIndex(intX, intY);
        const hWorld = heightToWorld(groundHeight[idx] ?? 0);
        return tileToWorld(tileX, tileY, hWorld, viewPointX, viewPointY);
    }
}

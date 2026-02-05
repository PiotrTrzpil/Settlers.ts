import { TileCoord } from '../entity';
import { IViewPoint } from '../renderer/i-view-point';
import { MapSize } from '@/utilities/map-size';

/**
 * Converts screen (canvas pixel) coordinates to tile coordinates.
 *
 * The landscape renderer uses a parallelogram grid where:
 *   worldX = tileX - tileY * 0.5
 *   worldY = (tileY - groundHeight) * 0.5
 *
 * The camera projection is:
 *   screenNDC_x = (worldX - viewPoint.x) * zoom * (2/aspectRatio) - 1
 *   screenNDC_y = 1 - (worldY - viewPoint.y) * zoom * 2
 *
 * We reverse this to get tile coords from a canvas click.
 */
export class TilePicker {
    private canvas: HTMLCanvasElement;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    /**
     * Convert a canvas pixel position to a tile coordinate.
     * Returns null if outside map bounds.
     */
    public screenToTile(
        screenX: number,
        screenY: number,
        viewPoint: IViewPoint,
        mapSize: MapSize,
        groundHeight: Uint8Array
    ): TileCoord | null {
        const canvas = this.canvas;
        const aspect = canvas.clientWidth / canvas.clientHeight;
        const zoom = viewPoint.zoom; // 0.1 / zoomValue

        // Convert pixel coords to NDC (-1 to 1)
        const ndcX = (screenX / canvas.clientWidth) * 2 - 1;
        const ndcY = 1 - (screenY / canvas.clientHeight) * 2;

        // Reverse projection: NDC -> world coordinates
        // From Renderer.draw():
        //   projection = ortho(-aspect, aspect, 1, -1, -1, 1).translate(-1, 1, 0).scale(zoom, zoom, 1)
        //
        // Effective transform:
        //   clipX = (worldX * (2/(right-left)) + (left+right)/(left-right) - 1) * zoom
        //   With left=-aspect, right=aspect:
        //   clipX = (worldX * (1/aspect) - 1) * zoom
        //   ndcX = worldX * zoom / aspect - zoom
        //   worldX = (ndcX + zoom) * aspect / zoom
        //
        //   clipY = (worldY * (2/(top-bottom)) + (bottom+top)/(bottom-top) + 1) * zoom
        //   With bottom=1, top=-1:
        //   clipY = (-worldY + 1) * zoom
        //   ndcY = -worldY * zoom + zoom
        //   worldY = (zoom - ndcY) / zoom

        const worldX = (ndcX + zoom) * aspect / zoom;
        const worldY = (zoom - ndcY) / zoom;

        // Reverse the tileToWorld transformation (must match shader formula exactly):
        //   Forward (tileToWorld, matches landscape-vert.glsl):
        //     vpInt = floor(viewPoint)
        //     vpFrac = viewPoint - vpInt
        //     instancePos = tile - vpInt
        //     worldX = 0.25 + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5
        //     worldY = (0.5 + instancePosY - height - vpFracY) * 0.5
        //
        //   Reverse (screenToTile):
        //     instancePosY = worldY * 2 - 0.5 + height + vpFracY
        //     tileY = instancePosY + vpIntY
        //     instancePosX = worldX - 0.25 + instancePosY * 0.5 + vpFracX - vpFracY * 0.5
        //     tileX = instancePosX + vpIntX

        const vpIntX = Math.floor(viewPoint.x);
        const vpIntY = Math.floor(viewPoint.y);
        const vpFracX = viewPoint.x - vpIntX;
        const vpFracY = viewPoint.y - vpIntY;

        // First pass: estimate tileY ignoring height
        let instancePosY = worldY * 2 - 0.5 + vpFracY;
        let tileY = Math.round(instancePosY + vpIntY);

        // Clamp to map
        tileY = Math.max(0, Math.min(mapSize.height - 1, tileY));

        // Estimate tileX
        let instancePosX = worldX - 0.25 + instancePosY * 0.5 + vpFracX - vpFracY * 0.5;
        let tileX = Math.round(instancePosX + vpIntX);
        tileX = Math.max(0, Math.min(mapSize.width - 1, tileX));

        // Refine using actual height at this tile
        const heightAtTile = groundHeight[mapSize.toIndex(tileX, tileY)];
        const heightOffset = heightAtTile * 20.0 / 255.0;

        // With height: instancePosY = worldY * 2 - 0.5 + height + vpFracY
        instancePosY = worldY * 2 - 0.5 + heightOffset + vpFracY;
        tileY = Math.round(instancePosY + vpIntY);
        tileY = Math.max(0, Math.min(mapSize.height - 1, tileY));

        instancePosX = worldX - 0.25 + instancePosY * 0.5 + vpFracX - vpFracY * 0.5;
        tileX = Math.round(instancePosX + vpIntX);
        tileX = Math.max(0, Math.min(mapSize.width - 1, tileX));

        // Wrap around map edges
        tileX = ((tileX % mapSize.width) + mapSize.width) % mapSize.width;
        tileY = ((tileY % mapSize.height) + mapSize.height) % mapSize.height;

        return { x: tileX, y: tileY };
    }

    /**
     * Convert tile coordinate to world position (for rendering entities).
     */
    public static tileToWorld(
        tileX: number,
        tileY: number,
        groundHeight: Uint8Array,
        mapSize: MapSize,
        viewPointX: number,
        viewPointY: number
    ): { worldX: number; worldY: number } {
        const heightIndex = mapSize.toIndex(tileX, tileY);
        const h = groundHeight[heightIndex];
        const heightScaled = h * 20.0 / 255.0;

        // Match the vertex shader transform EXACTLY (from landscape-vert.glsl):
        //   vec2 vpInt = floor(viewPoint);
        //   vec2 vpFrac = viewPoint - vpInt;
        //   instancePos = tile - vpInt  (relative to integer viewpoint)
        //
        //   worldX = 0.25 + instancePos.x - instancePos.y * 0.5 - vpFrac.x + vpFrac.y * 0.5
        //   worldY = (0.5 + instancePos.y - mapHeight - vpFrac.y) * 0.5
        //
        // The shader does NOT use staggered coordinates! The isometric effect comes
        // from the `-instancePos.y * 0.5` term in the X calculation.

        const vpIntX = Math.floor(viewPointX);
        const vpIntY = Math.floor(viewPointY);
        const vpFracX = viewPointX - vpIntX;
        const vpFracY = viewPointY - vpIntY;

        // instancePos is relative to floor(viewPoint)
        const instancePosX = tileX - vpIntX;
        const instancePosY = tileY - vpIntY;

        // Exact shader formula (0.25 and 0.5 are tile center offsets)
        const worldX = 0.25 + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5;
        const worldY = (0.5 + instancePosY - heightScaled - vpFracY) * 0.5;

        return { worldX, worldY };
    }
}

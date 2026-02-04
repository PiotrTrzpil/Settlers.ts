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

        // From vertex shader, the viewPoint is added to instancePos:
        //   pixelCoord = instancePos + viewPoint (shader viewPoint is -viewPoint.x, -viewPoint.y)
        //   worldX_rendered = pixelCoord.x - pixelCoord.y * 0.5
        //   worldY_rendered = (pixelCoord.y - height) * 0.5
        //
        // So: tileX_with_offset = worldX + viewPoint.x (undo the camera)
        //     But the shader passes -viewPoint.x, -viewPoint.y as 'viewPoint' uniform,
        //     and uses pixelCoord = instancePos + viewPoint.
        //
        // The rendered position for a tile (tx, ty) at height h is:
        //   rx = (tx + floor(ty/2) + vp.x) - (ty + vp.y) * 0.5
        //      where vp.x = -viewPoint.x, vp.y = -viewPoint.y (passed as uniform)
        //   This simplifies to:
        //   rx = tx + floor(ty/2) - viewPoint.x - (ty - viewPoint.y) * 0.5
        //   ry = ((ty - viewPoint.y) - h) * 0.5
        //
        // Ignoring height initially for a first approximation:
        //   worldY = (ty - viewPoint.y) * 0.5
        //   ty = worldY * 2 + viewPoint.y
        //
        //   worldX = tx + floor(ty/2) - viewPoint.x - (ty - viewPoint.y) * 0.5
        //   worldX = tx + floor(ty/2) - viewPoint.x - worldY
        //   tx = worldX - floor(ty/2) + viewPoint.x + worldY

        // First pass: estimate ty ignoring height
        let tileY = Math.round(worldY * 2 + viewPoint.y);

        // Clamp to map
        tileY = Math.max(0, Math.min(mapSize.height - 1, tileY));

        // Estimate tileX
        let tileX = Math.round(worldX - Math.floor(tileY / 2) + viewPoint.x + worldY);
        tileX = Math.max(0, Math.min(mapSize.width - 1, tileX));

        // Refine using actual height at this tile
        const heightAtTile = groundHeight[mapSize.toIndex(tileX, tileY)];
        const heightOffset = heightAtTile * 20.0 / 255.0; // shader reads height * 20.0 from texture (normalized 0-1 range)

        // With height: worldY = ((ty - viewPoint.y) - h) * 0.5
        // ty = worldY * 2 + viewPoint.y + h
        tileY = Math.round(worldY * 2 + viewPoint.y + heightOffset);
        tileY = Math.max(0, Math.min(mapSize.height - 1, tileY));

        tileX = Math.round(worldX - Math.floor(tileY / 2) + viewPoint.x + worldY);
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

        // Match the vertex shader transform:
        //   instancePos = (tileX + floor(tileY/2), tileY)  [from createInstancePosArray]
        //   pixelCoord = instancePos + shaderViewPoint  [shaderViewPoint = (-vpX, -vpY)]
        //   worldX = pixelCoord.x - pixelCoord.y * 0.5
        //   worldY = (pixelCoord.y - height) * 0.5
        //
        // Center of parallelogram (average of vertices 0,1,2):
        //   vertex0 = (0, 0), vertex1 = (-0.5, 1), vertex2 = (0.5, 1)
        //   center ≈ (0.0, 0.67) but for tile center use (0.25, 0.5)

        const instX = tileX + Math.floor(tileY / 2) - viewPointX;
        const instY = tileY - viewPointY;

        const worldX = instX + 0.25 - instY * 0.5;
        const worldY = (instY + 0.5 - heightScaled) * 0.5;

        return { worldX, worldY };
    }
}

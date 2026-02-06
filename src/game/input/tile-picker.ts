import { TileCoord } from '../entity';
import { IViewPointReadonly } from '../renderer/i-view-point';
import { MapSize } from '@/utilities/map-size';
import {
    TILE_CENTER_X,
    TILE_CENTER_Y,
    heightToWorld,
    MAX_SCREEN_TO_TILE_ITERATIONS,
} from '../systems/coordinate-system';

/**
 * Converts screen (canvas pixel) coordinates to tile coordinates.
 *
 * The landscape renderer uses a parallelogram grid where:
 *   worldX = TILE_CENTER_X + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5
 *   worldY = (TILE_CENTER_Y + instancePosY - heightWorld - vpFracY) * 0.5
 *
 * The camera projection is:
 *   ndcX = worldX * zoom / aspect - zoom
 *   ndcY = -worldY * zoom + zoom
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
     *
     * Uses iterative height refinement: the initial estimate ignores height,
     * then each iteration looks up the actual height at the estimated tile
     * and re-solves. This converges in 2-3 iterations on any terrain.
     */
    public screenToTile(
        screenX: number,
        screenY: number,
        viewPoint: IViewPointReadonly,
        mapSize: MapSize,
        groundHeight: Uint8Array
    ): TileCoord | null {
        const canvas = this.canvas;
        const aspect = canvas.clientWidth / canvas.clientHeight;
        const zoom = viewPoint.zoom;

        // Convert pixel coords to NDC (-1 to 1)
        const ndcX = (screenX / canvas.clientWidth) * 2 - 1;
        const ndcY = 1 - (screenY / canvas.clientHeight) * 2;

        // Reverse projection: NDC -> world coordinates
        const worldX = (ndcX + zoom) * aspect / zoom;
        const worldY = (zoom - ndcY) / zoom;

        // Reverse the forward tile-to-world transform:
        //   Forward:
        //     worldX = TILE_CENTER_X + instX - instY * 0.5 - vpFracX + vpFracY * 0.5
        //     worldY = (TILE_CENTER_Y + instY - hWorld - vpFracY) * 0.5
        //
        //   Reverse:
        //     instY = worldY * 2 - TILE_CENTER_Y + hWorld + vpFracY
        //     instX = worldX - TILE_CENTER_X + instY * 0.5 + vpFracX - vpFracY * 0.5

        const vpIntX = Math.floor(viewPoint.x);
        const vpIntY = Math.floor(viewPoint.y);
        const vpFracX = viewPoint.x - vpIntX;
        const vpFracY = viewPoint.y - vpIntY;

        // First estimate: assume height = 0
        let instancePosY = worldY * 2 - TILE_CENTER_Y + vpFracY;
        let tileY = Math.round(instancePosY + vpIntY);
        tileY = Math.max(0, Math.min(mapSize.height - 1, tileY));

        const instancePosX = worldX - TILE_CENTER_X + instancePosY * 0.5 + vpFracX - vpFracY * 0.5;
        let tileX = Math.round(instancePosX + vpIntX);
        tileX = Math.max(0, Math.min(mapSize.width - 1, tileX));

        // Iterative refinement: look up actual height, re-solve tile position.
        // Each iteration corrects for the height at the currently estimated tile.
        // Converges when the estimated tile stops changing.
        for (let iter = 0; iter < MAX_SCREEN_TO_TILE_ITERATIONS; iter++) {
            const h = groundHeight[mapSize.toIndex(tileX, tileY)];
            const hWorld = heightToWorld(h);

            const newInstancePosY = worldY * 2 - TILE_CENTER_Y + hWorld + vpFracY;
            const newTileY = Math.round(newInstancePosY + vpIntY);
            const clampedTileY = Math.max(0, Math.min(mapSize.height - 1, newTileY));

            const newInstancePosX = worldX - TILE_CENTER_X + newInstancePosY * 0.5 + vpFracX - vpFracY * 0.5;
            const newTileX = Math.round(newInstancePosX + vpIntX);
            const clampedTileX = Math.max(0, Math.min(mapSize.width - 1, newTileX));

            // Converged — tile didn't change
            if (clampedTileX === tileX && clampedTileY === tileY) break;

            tileX = clampedTileX;
            tileY = clampedTileY;
            instancePosY = newInstancePosY;
        }

        // Wrap around map edges
        tileX = ((tileX % mapSize.width) + mapSize.width) % mapSize.width;
        tileY = ((tileY % mapSize.height) + mapSize.height) % mapSize.height;

        return { x: tileX, y: tileY };
    }

    /**
     * Convert tile coordinate to world position (for rendering entities).
     * This is the canonical forward transform and MUST match landscape-vert.glsl.
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
        const hWorld = heightToWorld(groundHeight[heightIndex]);

        const vpIntX = Math.floor(viewPointX);
        const vpIntY = Math.floor(viewPointY);
        const vpFracX = viewPointX - vpIntX;
        const vpFracY = viewPointY - vpIntY;

        const instancePosX = tileX - vpIntX;
        const instancePosY = tileY - vpIntY;

        // Exact shader formula (see coordinate-system.ts for documentation)
        const worldX = TILE_CENTER_X + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5;
        const worldY = (TILE_CENTER_Y + instancePosY - hWorld - vpFracY) * 0.5;

        return { worldX, worldY };
    }
}

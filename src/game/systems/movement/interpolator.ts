import { MovementController } from './movement-controller';

/**
 * World coordinates in pixels (or rendering units).
 */
export interface WorldCoord {
    worldX: number;
    worldY: number;
}

/**
 * Function type for converting tile coordinates to world coordinates.
 * This abstraction allows the interpolator to work with any coordinate system.
 */
export type TileToWorldFn = (tileX: number, tileY: number) => WorldCoord;

/**
 * Interpolator for calculating smooth visual positions between tiles.
 * Pure functional calculations - no side effects.
 */
export class Interpolator {
    private tileToWorld: TileToWorldFn;

    constructor(tileToWorld: TileToWorldFn) {
        this.tileToWorld = tileToWorld;
    }

    /**
     * Get the interpolated world position for a movement controller.
     *
     * @param controller The movement controller to interpolate
     * @returns World coordinates for rendering
     */
    getInterpolatedPosition(controller: MovementController): WorldCoord {
        // Check if unit is stationary (prev == curr)
        if (!controller.isInTransit) {
            return this.tileToWorld(controller.tileX, controller.tileY);
        }

        // Calculate interpolation factor (clamp to 0-1)
        const t = Math.max(0, Math.min(controller.progress, 1));

        const prevPos = this.tileToWorld(controller.prevTileX, controller.prevTileY);
        const currPos = this.tileToWorld(controller.tileX, controller.tileY);

        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t,
        };
    }

    /**
     * Get interpolated position from raw state values.
     * Useful when you don't have a MovementController instance.
     */
    getInterpolatedPositionRaw(
        tileX: number,
        tileY: number,
        prevTileX: number,
        prevTileY: number,
        progress: number
    ): WorldCoord {
        // Check if stationary
        if (tileX === prevTileX && tileY === prevTileY) {
            return this.tileToWorld(tileX, tileY);
        }

        const t = Math.max(0, Math.min(progress, 1));
        const prevPos = this.tileToWorld(prevTileX, prevTileY);
        const currPos = this.tileToWorld(tileX, tileY);

        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t,
        };
    }

    /**
     * Update the tile-to-world conversion function.
     * Call this when the viewport or map data changes.
     */
    updateTileToWorld(fn: TileToWorldFn): void {
        this.tileToWorld = fn;
    }
}

/**
 * Create a simple linear interpolator for testing.
 * Uses direct tile coords as world coords with a scale factor.
 */
export function createTestInterpolator(scale: number = 32): Interpolator {
    return new Interpolator((x, y) => ({
        worldX: x * scale,
        worldY: y * scale,
    }));
}

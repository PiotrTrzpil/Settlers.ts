/**
 * FrameContext - Computed once per frame, shared across all renderers.
 *
 * This eliminates redundant calculations by computing bounds and world positions
 * once and caching them for the entire frame. Key benefits:
 *
 * 1. Bounds computed once (was 3x per frame)
 * 2. World positions cached per entity (was 3+ tileToWorld calls per entity)
 * 3. Immutable interface prevents accidental modification
 * 4. Clear contract for what's available during rendering
 *
 * Usage:
 *   const ctx = FrameContext.create(viewPoint, entities, ...);
 *   for (const entity of ctx.visibleEntities) {
 *     const pos = ctx.getWorldPos(entity); // Cached, no recomputation
 *   }
 */

import { Entity, EntityType } from '../entity';
import { UnitStateLookup } from '../game-state';
import { MapSize } from '@/utilities/map-size';
import { IViewPoint } from './i-view-point';
import {
    heightToWorld,
    TILE_CENTER_X,
    TILE_CENTER_Y,
} from '../systems/coordinate-system';

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC INTERFACES (immutable contracts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Axis-aligned bounding box.
 */
export interface Bounds {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
}

/**
 * World position (camera-relative coordinates for rendering).
 */
export interface WorldPos {
    readonly worldX: number;
    readonly worldY: number;
}

/**
 * Read-only frame context interface.
 * All data is computed once and cached for the frame.
 */
export interface IFrameContext {
    /** Current frame timestamp (performance.now()) */
    readonly frameTime: number;

    /** Interpolation alpha for smooth sub-tick animation (0-1) */
    readonly alpha: number;

    /** Current viewpoint (camera position, zoom) */
    readonly viewPoint: IViewPoint;

    /** Visible world bounds (camera frustum in world space) */
    readonly worldBounds: Bounds;

    /** Visible tile bounds (integer tile range) */
    readonly tileBounds: Bounds;

    /** Entities that passed visibility culling */
    readonly visibleEntities: readonly Entity[];

    /** Number of entities culled (for profiling) */
    readonly culledCount: number;

    /**
     * Get cached world position for an entity.
     * Returns undefined if entity wasn't in the visible set.
     */
    getWorldPos(entity: Entity): WorldPos | undefined;

    /**
     * Get cached world position by entity ID.
     * More efficient when you only have the ID.
     */
    getWorldPosById(entityId: number): WorldPos | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** Margin added to world bounds for safe culling (top/left/right) */
const WORLD_MARGIN = 2.0;

/** Extra margin for bottom of screen to account for tall sprites (trees extend upward from base) */
const WORLD_MARGIN_BOTTOM = 5.0;

/** Margin added to tile bounds to catch edge cases */
const TILE_MARGIN = 10;

// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mutable world position for internal computation.
 * Reused to avoid allocations during position calculation.
 */
interface MutableWorldPos {
    worldX: number;
    worldY: number;
}

/**
 * Parameters for creating a frame context.
 */
export interface FrameContextParams {
    viewPoint: IViewPoint;
    entities: Entity[];
    unitStates: UnitStateLookup;
    groundHeight: Uint8Array;
    mapSize: MapSize;
    alpha: number;
    isEntityVisible?: (entity: Entity) => boolean;
}

/**
 * FrameContext implementation.
 * Created fresh each frame via FrameContext.create().
 */
export class FrameContext implements IFrameContext {
    public readonly frameTime: number;
    public readonly alpha: number;
    public readonly viewPoint: IViewPoint;
    public readonly worldBounds: Bounds;
    public readonly tileBounds: Bounds;
    public readonly visibleEntities: Entity[];
    public readonly culledCount: number;

    // Position cache: entityId -> WorldPos
    private readonly positionCache: Map<number, WorldPos>;

    private constructor(
        frameTime: number,
        alpha: number,
        viewPoint: IViewPoint,
        worldBounds: Bounds,
        tileBounds: Bounds,
        visibleEntities: Entity[],
        culledCount: number,
        positionCache: Map<number, WorldPos>
    ) {
        this.frameTime = frameTime;
        this.alpha = alpha;
        this.viewPoint = viewPoint;
        this.worldBounds = worldBounds;
        this.tileBounds = tileBounds;
        this.visibleEntities = visibleEntities;
        this.culledCount = culledCount;
        this.positionCache = positionCache;
    }

    public getWorldPos(entity: Entity): WorldPos | undefined {
        return this.positionCache.get(entity.id);
    }

    public getWorldPosById(entityId: number): WorldPos | undefined {
        return this.positionCache.get(entityId);
    }

    /**
     * Create a new frame context for the current frame.
     * This is the main entry point - call once per frame.
     */
    public static create(params: FrameContextParams): FrameContext {
        const { viewPoint, entities, unitStates, groundHeight, mapSize, alpha, isEntityVisible } = params;
        const frameTime = performance.now();

        // Step 1: Compute bounds (once)
        const worldBounds = computeWorldBounds(viewPoint);
        const tileBounds = computeTileBounds(worldBounds, viewPoint);

        // Step 2: Filter visible entities and cache their world positions
        const visibleEntities: Entity[] = [];
        const positionCache = new Map<number, WorldPos>();
        let culledCount = 0;

        // Reusable position object for computation
        const tempPos: MutableWorldPos = { worldX: 0, worldY: 0 };

        for (const entity of entities) {
            // Fast tile-based culling first
            if (!isInTileBounds(entity, tileBounds)) {
                culledCount++;
                continue;
            }

            // Layer visibility check (if provided)
            if (isEntityVisible && !isEntityVisible(entity)) {
                culledCount++;
                continue;
            }

            // Compute world position (with interpolation for units)
            computeEntityWorldPos(
                entity,
                unitStates,
                groundHeight,
                mapSize,
                viewPoint,
                tempPos
            );

            // World bounds culling
            if (!isInWorldBounds(tempPos, worldBounds)) {
                culledCount++;
                continue;
            }

            // Entity is visible - cache position and add to list
            positionCache.set(entity.id, { worldX: tempPos.worldX, worldY: tempPos.worldY });
            visibleEntities.push(entity);
        }

        return new FrameContext(
            frameTime,
            alpha,
            viewPoint,
            worldBounds,
            tileBounds,
            visibleEntities,
            culledCount,
            positionCache
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute visible world bounds from viewpoint.
 * Uses larger bottom margin to account for tall sprites (trees) extending upward from base.
 */
function computeWorldBounds(viewPoint: IViewPoint): Bounds {
    const { zoom, aspectRatio: aspect } = viewPoint;
    return {
        minX: (-1 + zoom) * aspect / zoom - WORLD_MARGIN,
        maxX: (1 + zoom) * aspect / zoom + WORLD_MARGIN,
        minY: (zoom - 1) / zoom - WORLD_MARGIN,
        maxY: (zoom + 1) / zoom + WORLD_MARGIN_BOTTOM,
    };
}

/**
 * Compute visible tile bounds from world bounds.
 */
function computeTileBounds(worldBounds: Bounds, viewPoint: IViewPoint): Bounds {
    // Convert world corners to tile coordinates
    const c1 = worldToTileApprox(worldBounds.minX, worldBounds.minY, viewPoint);
    const c2 = worldToTileApprox(worldBounds.maxX, worldBounds.minY, viewPoint);
    const c3 = worldToTileApprox(worldBounds.maxX, worldBounds.maxY, viewPoint);
    const c4 = worldToTileApprox(worldBounds.minX, worldBounds.maxY, viewPoint);

    return {
        minX: Math.floor(Math.min(c1.x, c2.x, c3.x, c4.x)) - TILE_MARGIN,
        maxX: Math.ceil(Math.max(c1.x, c2.x, c3.x, c4.x)) + TILE_MARGIN,
        minY: Math.floor(Math.min(c1.y, c2.y, c3.y, c4.y)) - TILE_MARGIN,
        maxY: Math.ceil(Math.max(c1.y, c2.y, c3.y, c4.y)) + TILE_MARGIN,
    };
}

/**
 * Approximate world-to-tile conversion (ignores height for culling).
 * Good enough for bounds calculation since we add margin anyway.
 */
function worldToTileApprox(worldX: number, worldY: number, viewPoint: IViewPoint): { x: number; y: number } {
    const vpIntX = Math.floor(viewPoint.x);
    const vpIntY = Math.floor(viewPoint.y);
    const vpFracX = viewPoint.x - vpIntX;
    const vpFracY = viewPoint.y - vpIntY;

    const instancePosY = worldY * 2 - TILE_CENTER_Y + vpFracY;
    const tileY = instancePosY + vpIntY;

    const instancePosX = worldX - TILE_CENTER_X + instancePosY * 0.5 + vpFracX - vpFracY * 0.5;
    const tileX = instancePosX + vpIntX;

    return { x: tileX, y: tileY };
}

/**
 * Check if entity is within tile bounds.
 */
function isInTileBounds(entity: Entity, bounds: Bounds): boolean {
    return entity.x >= bounds.minX && entity.x <= bounds.maxX &&
           entity.y >= bounds.minY && entity.y <= bounds.maxY;
}

/**
 * Check if world position is within bounds.
 */
function isInWorldBounds(pos: MutableWorldPos, bounds: Bounds): boolean {
    return pos.worldX >= bounds.minX && pos.worldX <= bounds.maxX &&
           pos.worldY >= bounds.minY && pos.worldY <= bounds.maxY;
}

/**
 * Compute world position for an entity, writing to output object.
 * Handles unit interpolation automatically.
 */
function computeEntityWorldPos(
    entity: Entity,
    unitStates: UnitStateLookup,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    viewPoint: IViewPoint,
    out: MutableWorldPos
): void {
    if (entity.type === EntityType.Unit) {
        computeUnitWorldPos(entity, unitStates, groundHeight, mapSize, viewPoint, out);
    } else {
        computeTileWorldPos(entity.x, entity.y, groundHeight, mapSize, viewPoint, out);
    }
}

/**
 * Compute world position for a tile coordinate, writing to output object.
 * Inlines the tileToWorld calculation to avoid object allocation.
 */
function computeTileWorldPos(
    tileX: number,
    tileY: number,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    viewPoint: IViewPoint,
    out: MutableWorldPos
): void {
    const idx = mapSize.toIndex(tileX, tileY);
    const hWorld = heightToWorld(groundHeight[idx]);

    const vpIntX = Math.floor(viewPoint.x);
    const vpIntY = Math.floor(viewPoint.y);
    const vpFracX = viewPoint.x - vpIntX;
    const vpFracY = viewPoint.y - vpIntY;

    const instanceX = tileX - vpIntX;
    const instanceY = tileY - vpIntY;

    out.worldX = TILE_CENTER_X + instanceX - instanceY * 0.5 - vpFracX + vpFracY * 0.5;
    out.worldY = (TILE_CENTER_Y + instanceY - hWorld - vpFracY) * 0.5;
}

// Pre-allocated temp objects for unit interpolation (avoids per-unit allocation)
const _interpPrev: MutableWorldPos = { worldX: 0, worldY: 0 };
const _interpCurr: MutableWorldPos = { worldX: 0, worldY: 0 };

/**
 * Compute interpolated world position for a moving unit.
 */
function computeUnitWorldPos(
    entity: Entity,
    unitStates: UnitStateLookup,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    viewPoint: IViewPoint,
    out: MutableWorldPos
): void {
    const unitState = unitStates.get(entity.id);

    // Stationary units use simple tile position
    if (!unitState || (unitState.prevX === entity.x && unitState.prevY === entity.y)) {
        computeTileWorldPos(entity.x, entity.y, groundHeight, mapSize, viewPoint, out);
        return;
    }

    // Interpolate between previous and current position
    const t = Math.max(0, Math.min(unitState.moveProgress, 1));

    // Get both positions using pre-allocated objects
    computeTileWorldPos(unitState.prevX, unitState.prevY, groundHeight, mapSize, viewPoint, _interpPrev);
    computeTileWorldPos(entity.x, entity.y, groundHeight, mapSize, viewPoint, _interpCurr);

    out.worldX = _interpPrev.worldX + (_interpCurr.worldX - _interpPrev.worldX) * t;
    out.worldY = _interpPrev.worldY + (_interpCurr.worldY - _interpPrev.worldY) * t;
}

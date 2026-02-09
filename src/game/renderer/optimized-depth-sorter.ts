/**
 * OptimizedDepthSorter - High-performance entity depth sorting.
 *
 * Key optimizations over EntityDepthSorter:
 * 1. Accepts pre-computed world positions (no redundant tileToWorld calls)
 * 2. Pre-allocated buffers to avoid per-frame allocations
 * 3. Uses float depth keys for precision (avoids quantization issues)
 *
 * The depth key formula ensures correct painter's algorithm ordering:
 *   depth = worldY + spriteOffset + heightFactor * depthFactor
 *   Larger depth = drawn later = appears in front
 */

import { Entity, EntityType, BuildingType, UnitType, MapObjectType } from '../entity';
import { EMaterialType } from '../economy';
import { SpriteEntry } from './sprite-metadata';
import { SpriteRenderManager } from './sprite-render-manager';
import { WorldPos } from './frame-context';
import {
    DEPTH_FACTOR_BUILDING,
    DEPTH_FACTOR_MAP_OBJECT,
    DEPTH_FACTOR_UNIT,
    DEPTH_FACTOR_RESOURCE,
} from './entity-renderer-constants';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum expected entities (for pre-allocation).
 * Will grow automatically if exceeded.
 */
const INITIAL_CAPACITY = 4096;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Context for depth sorting.
 */
export interface OptimizedSortContext {
    spriteManager: SpriteRenderManager | null;
    getWorldPos: (entity: Entity) => WorldPos | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Optimized depth sorter with pre-allocated buffers.
 */
export class OptimizedDepthSorter {
    // Pre-allocated buffers
    private floatDepthKeys: Float64Array;
    private sortedIndices: Uint32Array;
    private tempEntities: Entity[];

    // Last sort state for incremental optimization
    private lastEntityCount = 0;
    private lastSortValid = false;

    constructor() {
        this.floatDepthKeys = new Float64Array(INITIAL_CAPACITY);
        this.sortedIndices = new Uint32Array(INITIAL_CAPACITY);
        this.tempEntities = new Array(INITIAL_CAPACITY);
    }

    /**
     * Sort entities by depth for painter's algorithm.
     * Modifies the input array in place.
     *
     * @param entities Array of entities to sort (modified in place)
     * @param ctx Sort context with sprite manager and position cache
     */
    public sortByDepth(entities: Entity[], ctx: OptimizedSortContext): void {
        const count = entities.length;
        if (count === 0) return;
        if (count === 1) return; // Already sorted

        // Ensure buffers are large enough
        this.ensureCapacity(count);

        // Compute depth keys (as floats for precision)
        for (let i = 0; i < count; i++) {
            const entity = entities[i];
            const worldPos = ctx.getWorldPos(entity);
            const spriteEntry = this.getSpriteEntry(entity, ctx.spriteManager);
            this.floatDepthKeys[i] = this.computeFloatDepthKey(entity, worldPos, spriteEntry);
            this.sortedIndices[i] = i;
        }

        // Sort indices by depth key (smaller = behind = drawn first)
        // Using a stable comparison sort - more reliable than radix for floats
        const keys = this.floatDepthKeys;
        const indices = this.sortedIndices;

        // Convert to regular array for sort (TypedArray.sort doesn't take comparator)
        const indexArray: number[] = [];
        for (let i = 0; i < count; i++) {
            indexArray[i] = indices[i];
        }
        indexArray.length = count;
        indexArray.sort((a, b) => keys[a] - keys[b]);

        // Reorder entities using sorted indices
        for (let i = 0; i < count; i++) {
            this.tempEntities[i] = entities[indexArray[i]];
        }
        for (let i = 0; i < count; i++) {
            entities[i] = this.tempEntities[i];
        }

        this.lastEntityCount = count;
        this.lastSortValid = true;
    }

    /**
     * Compute float depth key for an entity (preserves precision).
     */
    private computeFloatDepthKey(entity: Entity, worldPos: WorldPos | undefined, spriteEntry: SpriteEntry | null): number {
        let depth = worldPos?.worldY ?? 0;

        if (spriteEntry) {
            const { offsetY, heightWorld } = spriteEntry;
            const depthFactor = this.getDepthFactor(entity.type);
            depth = depth + offsetY + heightWorld * depthFactor;
        }

        return depth;
    }

    /**
     * Invalidate the incremental sort cache.
     * Call when camera moves significantly or entities added/removed.
     */
    public invalidate(): void {
        this.lastSortValid = false;
    }

    /**
     * Check if incremental sort is possible.
     */
    public canIncrementalSort(currentCount: number): boolean {
        return this.lastSortValid && currentCount === this.lastEntityCount;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Ensure all buffers can hold the given count.
     */
    private ensureCapacity(count: number): void {
        if (this.floatDepthKeys.length >= count) return;

        // Grow by 2x to amortize allocation cost
        const newCapacity = Math.max(count, this.floatDepthKeys.length * 2);
        this.floatDepthKeys = new Float64Array(newCapacity);
        this.sortedIndices = new Uint32Array(newCapacity);
        this.tempEntities = new Array(newCapacity);
    }

    /**
     * Get depth factor for entity type.
     */
    private getDepthFactor(entityType: EntityType): number {
        switch (entityType) {
        case EntityType.Building:
            return DEPTH_FACTOR_BUILDING;
        case EntityType.MapObject:
            return DEPTH_FACTOR_MAP_OBJECT;
        case EntityType.Unit:
            return DEPTH_FACTOR_UNIT;
        case EntityType.StackedResource:
            return DEPTH_FACTOR_RESOURCE;
        default:
            return 1.0;
        }
    }

    /**
     * Get sprite entry for an entity.
     */
    private getSpriteEntry(entity: Entity, spriteManager: SpriteRenderManager | null): SpriteEntry | null {
        if (!spriteManager) return null;

        switch (entity.type) {
        case EntityType.Building:
            return spriteManager.getBuilding(entity.subType as BuildingType);
        case EntityType.MapObject:
            return spriteManager.getMapObject(entity.subType as MapObjectType);
        case EntityType.Unit:
            return spriteManager.getUnit(entity.subType as UnitType);
        case EntityType.StackedResource:
            return spriteManager.getResource(entity.subType as EMaterialType);
        default:
            return null;
        }
    }

}

/**
 * OptimizedDepthSorter - High-performance entity depth sorting.
 *
 * Key optimizations over EntityDepthSorter:
 * 1. Uses radix sort (O(n)) instead of callback sort (O(n log n))
 * 2. Accepts pre-computed world positions (no redundant tileToWorld calls)
 * 3. Quantizes depth to integers for fast sorting
 * 4. Supports incremental sorting when few entities moved
 * 5. Pre-allocated buffers to avoid per-frame allocations
 *
 * The depth key formula ensures correct painter's algorithm ordering:
 *   depth = worldY + spriteOffset + heightFactor * depthFactor
 *   Larger depth = drawn later = appears in front
 */

import { Entity, EntityType, BuildingType, UnitType, MapObjectType } from '../entity';
import { EMaterialType } from '../economy/material-type';
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
 * Depth quantization scale.
 * World Y ranges roughly -2 to +2, sprites add up to ~1.
 * Scale by 10000 gives 10000 buckets, plenty of precision.
 */
const DEPTH_SCALE = 10000;

/**
 * Offset to ensure all depth values are positive for radix sort.
 */
const DEPTH_OFFSET = 50000;

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
 * Optimized depth sorter using counting/radix sort.
 */
export class OptimizedDepthSorter {
    // Pre-allocated buffers
    private depthKeys: Uint32Array;
    private sortedIndices: Uint32Array;
    private tempEntities: Entity[];

    // Radix sort temp buffers (pre-allocated to avoid per-frame allocation)
    private tempKeys: Uint32Array;
    private tempIndices: Uint32Array;

    // Counting sort buckets (16-bit radix = 65536 buckets)
    private counts: Uint32Array;

    // Last sort state for incremental optimization
    private lastEntityCount = 0;
    private lastSortValid = false;

    constructor() {
        this.depthKeys = new Uint32Array(INITIAL_CAPACITY);
        this.sortedIndices = new Uint32Array(INITIAL_CAPACITY);
        this.tempEntities = new Array(INITIAL_CAPACITY);
        this.tempKeys = new Uint32Array(INITIAL_CAPACITY);
        this.tempIndices = new Uint32Array(INITIAL_CAPACITY);
        this.counts = new Uint32Array(65536);
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

        // Compute depth keys
        for (let i = 0; i < count; i++) {
            const entity = entities[i];
            const worldPos = ctx.getWorldPos(entity);
            const spriteEntry = this.getSpriteEntry(entity, ctx.spriteManager);
            this.depthKeys[i] = this.computeDepthKey(entity, worldPos, spriteEntry);
        }

        // Perform radix sort (2-pass 16-bit radix)
        this.radixSort(count);

        // Reorder entities using sorted indices
        for (let i = 0; i < count; i++) {
            this.tempEntities[i] = entities[this.sortedIndices[i]];
        }
        for (let i = 0; i < count; i++) {
            entities[i] = this.tempEntities[i];
        }

        this.lastEntityCount = count;
        this.lastSortValid = true;
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
        if (this.depthKeys.length >= count) return;

        // Grow by 2x to amortize allocation cost
        const newCapacity = Math.max(count, this.depthKeys.length * 2);
        this.depthKeys = new Uint32Array(newCapacity);
        this.sortedIndices = new Uint32Array(newCapacity);
        this.tempEntities = new Array(newCapacity);
        this.tempKeys = new Uint32Array(newCapacity);
        this.tempIndices = new Uint32Array(newCapacity);
    }

    /**
     * Compute quantized depth key for an entity.
     */
    private computeDepthKey(entity: Entity, worldPos: WorldPos | undefined, spriteEntry: SpriteEntry | null): number {
        // Base depth from world Y position
        let depth = worldPos?.worldY ?? 0;

        // Adjust for sprite dimensions
        if (spriteEntry) {
            const { offsetY, heightWorld } = spriteEntry;
            const depthFactor = this.getDepthFactor(entity.type);
            depth = depth + offsetY + heightWorld * depthFactor;
        }

        // Quantize to integer (offset ensures positive, scale gives precision)
        return Math.round(depth * DEPTH_SCALE + DEPTH_OFFSET);
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

    /**
     * Radix sort using 2-pass 16-bit radix.
     * This is O(n) compared to O(n log n) for comparison sort.
     */
    private radixSort(count: number): void {
        const keys = this.depthKeys;
        const indices = this.sortedIndices;
        const counts = this.counts;
        const tempKeys = this.tempKeys;
        const tempIndices = this.tempIndices;

        // Initialize indices
        for (let i = 0; i < count; i++) {
            indices[i] = i;
        }

        // Pass 1: Sort by low 16 bits
        counts.fill(0);
        for (let i = 0; i < count; i++) {
            counts[keys[i] & 0xFFFF]++;
        }
        // Prefix sum
        let total = 0;
        for (let i = 0; i < 65536; i++) {
            const c = counts[i];
            counts[i] = total;
            total += c;
        }
        // Scatter
        for (let i = 0; i < count; i++) {
            const bucket = keys[i] & 0xFFFF;
            const pos = counts[bucket]++;
            tempKeys[pos] = keys[i];
            tempIndices[pos] = indices[i];
        }

        // Pass 2: Sort by high 16 bits
        counts.fill(0);
        for (let i = 0; i < count; i++) {
            counts[(tempKeys[i] >> 16) & 0xFFFF]++;
        }
        // Prefix sum
        total = 0;
        for (let i = 0; i < 65536; i++) {
            const c = counts[i];
            counts[i] = total;
            total += c;
        }
        // Scatter back to sorted indices
        for (let i = 0; i < count; i++) {
            const bucket = (tempKeys[i] >> 16) & 0xFFFF;
            const pos = counts[bucket]++;
            this.sortedIndices[pos] = tempIndices[i];
        }
    }
}

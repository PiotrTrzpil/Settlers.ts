import { Entity, EntityType, BuildingType, UnitType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { SpriteEntry } from './sprite-metadata';
import { SpriteRenderManager } from './sprite-render-manager';
import { EMaterialType } from '../economy';
import {
    DEPTH_FACTOR_BUILDING,
    DEPTH_FACTOR_MAP_OBJECT,
    DEPTH_FACTOR_UNIT,
    DEPTH_FACTOR_PILE,
    FLAT_SPRITE_DEPTH_BIAS,
} from './entity-renderer-constants';
import { getEntityWorldPos, type WorldPositionContext } from './world-position';

/**
 * Context needed for depth sorting entities.
 */
export interface DepthSortContext extends WorldPositionContext {
    spriteManager: SpriteRenderManager | null;
    getVariation: (entityId: number) => number;
}

/**
 * Handles depth sorting of entities for correct painter's algorithm rendering.
 * Entities are sorted back-to-front so closer entities are drawn last.
 */
export class EntityDepthSorter {
    // Reusable arrays to avoid per-frame allocations
    private depthKeys: number[] = [];
    private sortIndices: number[] = [];
    private sortTempEntities: Entity[] = [];

    /**
     * Sort entities by depth for correct painter's algorithm rendering.
     * Modifies the input array in place.
     * @param entities Array of entities to sort (modified in place)
     * @param ctx Context with map data, view point, and sprite manager
     */
    public sortByDepth(entities: Entity[], ctx: DepthSortContext): void {
        const count = entities.length;
        if (count === 0) return;

        // Ensure arrays are large enough
        if (this.depthKeys.length < count) {
            this.depthKeys.length = count;
            this.sortIndices.length = count;
            this.sortTempEntities.length = count;
        }

        // Compute depth keys for all entities
        for (let i = 0; i < count; i++) {
            const entity = entities[i]!;
            const worldPos = getEntityWorldPos(entity, ctx);
            const spriteEntry = this.getSpriteEntry(entity, ctx.spriteManager);
            this.depthKeys[i] = this.computeDepthKey(entity, worldPos.worldY, spriteEntry, ctx);
            this.sortIndices[i] = i;
        }

        // Sort indices by depth key (smaller = behind = drawn first)
        const depthKeys = this.depthKeys;
        this.sortIndices.length = count;
        this.sortIndices.sort((a, b) => depthKeys[a]! - depthKeys[b]!);

        // Reorder entities using temp array
        for (let i = 0; i < count; i++) {
            this.sortTempEntities[i] = entities[this.sortIndices[i]!]!;
        }
        for (let i = 0; i < count; i++) {
            entities[i] = this.sortTempEntities[i]!;
        }
    }

    /**
     * Get sprite entry for an entity (if available).
     */
    private getSpriteEntry(entity: Entity, spriteManager: SpriteRenderManager | null): SpriteEntry | null {
        if (!spriteManager) return null;

        switch (entity.type) {
        case EntityType.Building:
            return spriteManager.getBuilding(entity.subType as BuildingType, entity.race);
        case EntityType.MapObject:
            return spriteManager.getMapObject(entity.subType as MapObjectType);
        case EntityType.Unit:
            return spriteManager.getUnit(entity.subType as UnitType, 0, entity.race);
        case EntityType.StackedPile:
            return spriteManager.getGoodSprite(entity.subType as EMaterialType);
        case EntityType.Decoration:
        case EntityType.None:
            return null;
        }
    }

    /**
     * Compute the depth key for an entity for painter's algorithm sorting.
     * Larger depth = drawn later = appears in front.
     */
    private computeDepthKey(
        entity: Entity,
        worldY: number,
        spriteEntry: SpriteEntry | null,
        ctx: DepthSortContext
    ): number {
        // Base depth is the world Y coordinate (larger = lower on screen = in front)
        let depth = worldY;

        // Adjust depth based on sprite dimensions and entity-specific depth factor
        if (spriteEntry) {
            const { offsetY, heightWorld } = spriteEntry;
            let depthFactor: number;

            switch (entity.type) {
            case EntityType.Building:
                depthFactor = DEPTH_FACTOR_BUILDING;
                break;
            case EntityType.MapObject:
                depthFactor = DEPTH_FACTOR_MAP_OBJECT;
                break;
            case EntityType.Unit:
                depthFactor = DEPTH_FACTOR_UNIT;
                break;
            case EntityType.StackedPile:
                depthFactor = DEPTH_FACTOR_PILE;
                break;
            case EntityType.Decoration:
                depthFactor = DEPTH_FACTOR_BUILDING;
                break;
            case EntityType.None:
                depthFactor = 1.0;
                break;
            }

            // Depth point = base position + offset to the depth line within sprite
            depth = worldY + offsetY + heightWorld * depthFactor;
        }

        // Flat sprites: render on terrain but behind standing trees, units, and other buildings
        const isFlatTree = entity.type === EntityType.MapObject && ctx.getVariation(entity.id) >= 4;
        const isFlatBuilding = entity.type === EntityType.Building && entity.subType === BuildingType.StorageArea;
        if (isFlatTree || isFlatBuilding) {
            depth -= FLAT_SPRITE_DEPTH_BIAS;
        }

        if (entity.depthBias) {
            depth += entity.depthBias;
        }

        return depth;
    }
}

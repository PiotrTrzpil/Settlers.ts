import { IViewPoint } from './i-view-point';
import { Entity, EntityType, BuildingType, UnitType, MapObjectType } from '../entity';
import { UnitStateLookup } from '../game-state';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { SpriteEntry } from './sprite-metadata';
import { SpriteRenderManager } from './sprite-render-manager';
import { EMaterialType } from '../economy/material-type';
import {
    DEPTH_FACTOR_BUILDING,
    DEPTH_FACTOR_MAP_OBJECT,
    DEPTH_FACTOR_UNIT,
    DEPTH_FACTOR_RESOURCE,
} from './entity-renderer-constants';

/**
 * Context needed for depth sorting entities.
 */
export interface DepthSortContext {
    mapSize: MapSize;
    groundHeight: Uint8Array;
    viewPoint: IViewPoint;
    unitStates: UnitStateLookup;
    spriteManager: SpriteRenderManager | null;
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
            const entity = entities[i];
            const worldPos = this.getWorldPos(entity, ctx);
            const spriteEntry = this.getSpriteEntry(entity, ctx.spriteManager);
            this.depthKeys[i] = this.computeDepthKey(entity, worldPos.worldY, spriteEntry);
            this.sortIndices[i] = i;
        }

        // Sort indices by depth key (smaller = behind = drawn first)
        const depthKeys = this.depthKeys;
        this.sortIndices.length = count;
        this.sortIndices.sort((a, b) => depthKeys[a] - depthKeys[b]);

        // Reorder entities using temp array
        for (let i = 0; i < count; i++) {
            this.sortTempEntities[i] = entities[this.sortIndices[i]];
        }
        for (let i = 0; i < count; i++) {
            entities[i] = this.sortTempEntities[i];
        }
    }

    /**
     * Get world position for an entity (with interpolation for units).
     */
    private getWorldPos(entity: Entity, ctx: DepthSortContext): { worldX: number; worldY: number } {
        if (entity.type === EntityType.Unit) {
            return this.getInterpolatedWorldPos(entity, ctx);
        }
        return TilePicker.tileToWorld(
            entity.x, entity.y,
            ctx.groundHeight, ctx.mapSize,
            ctx.viewPoint.x, ctx.viewPoint.y
        );
    }

    /**
     * Get the interpolated world position for a unit.
     */
    private getInterpolatedWorldPos(entity: Entity, ctx: DepthSortContext): { worldX: number; worldY: number } {
        const unitState = ctx.unitStates.get(entity.id);

        const isStationary = !unitState ||
            (unitState.prevX === entity.x && unitState.prevY === entity.y);

        if (isStationary) {
            return TilePicker.tileToWorld(
                entity.x, entity.y,
                ctx.groundHeight, ctx.mapSize,
                ctx.viewPoint.x, ctx.viewPoint.y
            );
        }

        const prevPos = TilePicker.tileToWorld(
            unitState.prevX, unitState.prevY,
            ctx.groundHeight, ctx.mapSize,
            ctx.viewPoint.x, ctx.viewPoint.y
        );
        const currPos = TilePicker.tileToWorld(
            entity.x, entity.y,
            ctx.groundHeight, ctx.mapSize,
            ctx.viewPoint.x, ctx.viewPoint.y
        );

        const t = Math.max(0, Math.min(unitState.moveProgress, 1));
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t
        };
    }

    /**
     * Get sprite entry for an entity (if available).
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
     * Compute the depth key for an entity for painter's algorithm sorting.
     * Larger depth = drawn later = appears in front.
     */
    private computeDepthKey(entity: Entity, worldY: number, spriteEntry: SpriteEntry | null): number {
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
            case EntityType.StackedResource:
                depthFactor = DEPTH_FACTOR_RESOURCE;
                break;
            default:
                depthFactor = 1.0;
            }

            // Depth point = base position + offset to the depth line within sprite
            depth = worldY + offsetY + heightWorld * depthFactor;
        }

        return depth;
    }
}

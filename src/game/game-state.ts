import { Entity, EntityType, UnitType, UnitState, BuildingState, BuildingConstructionPhase, tileKey, BuildingType, getBuildingFootprint, StackedResourceState, MAX_RESOURCE_STACK_SIZE, isUnitTypeSelectable, getUnitTypeSpeed } from './entity';
import { EMaterialType } from './economy/material-type';

/** Default building construction duration in seconds */
export const DEFAULT_CONSTRUCTION_DURATION = 30;

export class GameState {
    public entities: Entity[] = [];
    /** O(1) entity lookup by ID */
    private entityMap: Map<number, Entity> = new Map();
    public unitStates: Map<number, UnitState> = new Map();
    /** Building construction state tracking */
    public buildingStates: Map<number, BuildingState> = new Map();
    /** Stacked resource state tracking (quantity of items in each stack) */
    public resourceStates: Map<number, StackedResourceState> = new Map();
    /** Primary selection (first selected entity or single selection) */
    public selectedEntityId: number | null = null;
    /** All selected entity IDs (for multi-select) */
    public selectedEntityIds: Set<number> = new Set();
    public nextId = 1;

    /** Spatial lookup: "x,y" -> entityId */
    public tileOccupancy: Map<string, number> = new Map();

    /**
     * Add an entity to the game state.
     * For units, selectable and speed default to the UnitTypeConfig values
     * unless explicitly overridden.
     */
    public addEntity(type: EntityType, subType: number, x: number, y: number, player: number, selectable?: boolean): Entity {
        // Determine selectability: explicit override > unit type config > true
        let resolvedSelectable: boolean | undefined;
        if (selectable !== undefined) {
            resolvedSelectable = selectable;
        } else if (type === EntityType.Unit) {
            resolvedSelectable = isUnitTypeSelectable(subType as UnitType);
        }
        // Leave undefined for non-unit entities (treated as true by selection logic)

        const entity: Entity = {
            id: this.nextId++,
            type,
            x,
            y,
            player,
            subType,
            selectable: resolvedSelectable,
        };

        this.entities.push(entity);
        this.entityMap.set(entity.id, entity);

        // Add occupancy for all tiles in the entity's footprint
        if (type === EntityType.Building) {
            const footprint = getBuildingFootprint(x, y, subType as BuildingType);
            for (const tile of footprint) {
                this.tileOccupancy.set(tileKey(tile.x, tile.y), entity.id);
            }
        } else {
            this.tileOccupancy.set(tileKey(x, y), entity.id);
        }

        if (type === EntityType.Unit) {
            this.unitStates.set(entity.id, {
                entityId: entity.id,
                path: [],
                pathIndex: 0,
                moveProgress: 0,
                speed: getUnitTypeSpeed(subType as UnitType),
                prevX: x,
                prevY: y
            });
        }

        if (type === EntityType.Building) {
            this.buildingStates.set(entity.id, {
                entityId: entity.id,
                buildingType: subType as BuildingType,
                phase: BuildingConstructionPhase.TerrainLeveling, // Start immediately with terrain leveling
                phaseProgress: 0,
                totalDuration: DEFAULT_CONSTRUCTION_DURATION,
                elapsedTime: 0,
                tileX: x,
                tileY: y,
                originalTerrain: null,
                terrainModified: false,
            });
        }

        if (type === EntityType.StackedResource) {
            this.resourceStates.set(entity.id, {
                entityId: entity.id,
                quantity: 1,
            });
        }

        return entity;
    }

    public removeEntity(id: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) return;

        const index = this.entities.indexOf(entity);
        if (index >= 0) {
            this.entities.splice(index, 1);
        }

        this.entityMap.delete(id);

        // Remove occupancy for all tiles in the entity's footprint
        if (entity.type === EntityType.Building) {
            const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType);
            for (const tile of footprint) {
                this.tileOccupancy.delete(tileKey(tile.x, tile.y));
            }
        } else {
            this.tileOccupancy.delete(tileKey(entity.x, entity.y));
        }

        this.unitStates.delete(id);
        this.buildingStates.delete(id);
        this.resourceStates.delete(id);

        this.selectedEntityIds.delete(id);
        if (this.selectedEntityId === id) {
            this.selectedEntityId = null;
        }
    }

    public getEntity(id: number): Entity | undefined {
        return this.entityMap.get(id);
    }

    public getEntityAt(x: number, y: number): Entity | undefined {
        const id = this.tileOccupancy.get(tileKey(x, y));
        if (id === undefined) return undefined;
        return this.entityMap.get(id);
    }

    public getEntitiesInRadius(x: number, y: number, radius: number): Entity[] {
        const result: Entity[] = [];
        const r2 = radius * radius;
        for (const entity of this.entities) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            if (dx * dx + dy * dy <= r2) {
                result.push(entity);
            }
        }
        return result;
    }

    /** Get all entities within a rectangular tile region */
    public getEntitiesInRect(x1: number, y1: number, x2: number, y2: number): Entity[] {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        return this.entities.filter(e =>
            e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY
        );
    }

    /** Update occupancy when an entity moves */
    public updateEntityPosition(id: number, newX: number, newY: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) return;

        this.tileOccupancy.delete(tileKey(entity.x, entity.y));
        entity.x = newX;
        entity.y = newY;
        this.tileOccupancy.set(tileKey(newX, newY), id);
    }

    // ==========================================
    // Stacked Resource Management Methods
    // ==========================================

    /**
     * Add a stacked resource at the specified position.
     * If there's already a stack of the same material type, adds to it (up to MAX_RESOURCE_STACK_SIZE).
     * Otherwise creates a new stack.
     * @returns The entity if created/updated successfully, null if stack is full or tile occupied by different entity
     */
    public addStackedResource(materialType: EMaterialType, x: number, y: number, player: number): Entity | null {
        const key = tileKey(x, y);
        const existingId = this.tileOccupancy.get(key);

        if (existingId !== undefined) {
            const existing = this.entityMap.get(existingId);
            if (existing && existing.type === EntityType.StackedResource && existing.subType === materialType) {
                // Add to existing stack if not full
                const state = this.resourceStates.get(existingId);
                if (state && state.quantity < MAX_RESOURCE_STACK_SIZE) {
                    state.quantity++;
                    return existing;
                }
                // Stack is full
                return null;
            }
            // Tile is occupied by a different entity
            return null;
        }

        // Create new stack
        return this.addEntity(EntityType.StackedResource, materialType, x, y, player);
    }

    /**
     * Remove one item from a stacked resource.
     * If the stack becomes empty, removes the entity entirely.
     * @returns true if item was removed, false if no stack exists or stack was empty
     */
    public removeResourceFromStack(entityId: number): boolean {
        const entity = this.entityMap.get(entityId);
        if (!entity || entity.type !== EntityType.StackedResource) return false;

        const state = this.resourceStates.get(entityId);
        if (!state || state.quantity <= 0) return false;

        state.quantity--;

        if (state.quantity <= 0) {
            this.removeEntity(entityId);
        }

        return true;
    }

    /**
     * Get the stacked resource entity at a position, if any.
     */
    public getStackedResourceAt(x: number, y: number): Entity | undefined {
        const entity = this.getEntityAt(x, y);
        if (entity && entity.type === EntityType.StackedResource) {
            return entity;
        }
        return undefined;
    }

    /**
     * Get the quantity of resources in a stack.
     * @returns The quantity, or 0 if the entity doesn't exist or isn't a stack
     */
    public getResourceQuantity(entityId: number): number {
        const state = this.resourceStates.get(entityId);
        return state?.quantity ?? 0;
    }

    /**
     * Set the quantity of resources in a stack directly.
     * If quantity is 0 or less, removes the entity.
     */
    public setResourceQuantity(entityId: number, quantity: number): void {
        const entity = this.entityMap.get(entityId);
        if (!entity || entity.type !== EntityType.StackedResource) return;

        if (quantity <= 0) {
            this.removeEntity(entityId);
            return;
        }

        const state = this.resourceStates.get(entityId);
        if (state) {
            state.quantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);
        }
    }

    /**
     * Find the nearest stacked resource of a specific material type within a radius.
     */
    public findNearestResource(x: number, y: number, materialType: EMaterialType, radius: number): Entity | undefined {
        let nearest: Entity | undefined;
        let nearestDist = Infinity;

        for (const entity of this.entities) {
            if (entity.type !== EntityType.StackedResource) continue;
            if (entity.subType !== materialType) continue;

            const dx = entity.x - x;
            const dy = entity.y - y;
            const dist = dx * dx + dy * dy;

            if (dist <= radius * radius && dist < nearestDist) {
                nearest = entity;
                nearestDist = dist;
            }
        }

        return nearest;
    }
}

/**
 * StackedResourceManager — owns stacked resource state (quantities, building ownership).
 *
 * Extracted from GameState per design-rules.md Rule 5.1: feature-specific state
 * should not live inside the entity store.
 */

import type { StackedResourceState } from './entity';
import { MAX_RESOURCE_STACK_SIZE, EntityType, type Entity, type EntityProvider } from './entity';
import type { EMaterialType } from './economy';

export class StackedResourceManager {
    /** Stacked resource state tracking (quantity of items in each stack) */
    public readonly states: Map<number, StackedResourceState> = new Map();

    constructor(private entityProvider: EntityProvider) {}

    /** Create initial state for a new stacked resource entity. */
    createState(entityId: number): void {
        this.states.set(entityId, { entityId, quantity: 1 });
    }

    /** Remove state when a stacked resource entity is deleted. */
    removeState(entityId: number): void {
        this.states.delete(entityId);
    }

    /** Set the quantity of resources in a stack directly. */
    setQuantity(entityId: number, quantity: number): void {
        const state = this.states.get(entityId);
        if (state) {
            state.quantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);
        }
    }

    /**
     * Mark a stacked resource as belonging to a building's inventory visualization.
     * Resources with a buildingId are reserved and won't be picked up by carriers.
     */
    setBuildingId(entityId: number, buildingId: number | undefined): void {
        const state = this.states.get(entityId);
        if (state) {
            state.buildingId = buildingId;
        }
    }

    /**
     * Get the building ID that a stacked resource belongs to.
     * Returns undefined if the resource is free (not belonging to any building).
     */
    getBuildingId(entityId: number): number | undefined {
        const state = this.states.get(entityId);
        return state?.buildingId;
    }

    /**
     * Find the nearest free stacked resource of the given material type.
     * Excludes resources that belong to a building (have buildingId set).
     */
    findNearestResource(x: number, y: number, materialType: EMaterialType, radius: number): Entity | undefined {
        let nearest: Entity | undefined;
        let minDistSq = radius * radius;

        for (const entity of this.entityProvider.entities) {
            if (entity.type !== EntityType.StackedResource) continue;
            if (entity.subType !== materialType) continue;
            const state = this.states.get(entity.id);
            if (state?.buildingId !== undefined) continue;

            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = entity;
            }
        }
        return nearest;
    }
}

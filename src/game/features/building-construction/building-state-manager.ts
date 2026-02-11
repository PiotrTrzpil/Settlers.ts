/**
 * BuildingStateManager - Manages all building construction states.
 * Provides CRUD operations for building states.
 *
 * Following the Manager pattern (Rule 4.1):
 * - Manager owns state, provides CRUD
 * - System handles per-frame behavior
 *
 * State is stored on entity.construction (RFC: Entity-Owned State).
 */

import type { EventBus } from '../../event-bus';
import { BuildingType } from '../../buildings/types';
import { BuildingConstructionPhase, type BuildingState } from './types';
import type { EntityProvider } from '../../entity';

/** Default building construction duration in seconds */
export const DEFAULT_CONSTRUCTION_DURATION = 10;

/**
 * Manages building construction states for all buildings.
 * Provides CRUD operations and queries.
 *
 * State is stored on entity.construction (RFC: Entity-Owned State).
 */
export class BuildingStateManager {
    /** Entity provider for accessing entities */
    private entityProvider: EntityProvider | undefined;

    /** Event bus for emitting building events */
    private eventBus: EventBus | undefined;

    /**
     * Set the entity provider (called by GameState after construction).
     */
    setEntityProvider(provider: EntityProvider): void {
        this.entityProvider = provider;
    }

    /**
     * Register event bus for emitting building events.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
    }

    /**
     * Create a new building state.
     * @param entityId - The entity ID of the building
     * @param buildingType - The type of building
     * @param x - Tile X position
     * @param y - Tile Y position
     * @param totalDuration - Construction duration in seconds
     * @returns The created building state
     */
    createBuildingState(
        entityId: number,
        buildingType: BuildingType,
        x: number,
        y: number,
        totalDuration: number = DEFAULT_CONSTRUCTION_DURATION
    ): BuildingState {
        const entity = this.entityProvider?.getEntity(entityId);
        if (!entity) {
            throw new Error(`Cannot create building state: entity ${entityId} not found`);
        }

        const state: BuildingState = {
            entityId,
            buildingType,
            phase: BuildingConstructionPhase.TerrainLeveling,
            phaseProgress: 0,
            totalDuration,
            elapsedTime: 0,
            tileX: x,
            tileY: y,
            originalTerrain: null,
            terrainModified: false,
        };

        // Store state on entity (RFC: Entity-Owned State)
        entity.construction = state;
        return state;
    }

    /**
     * Remove a building state.
     * @param entityId - The entity ID of the building
     * @returns true if the state was removed
     */
    removeBuildingState(entityId: number): boolean {
        const entity = this.entityProvider?.getEntity(entityId);
        if (entity?.construction) {
            delete entity.construction;
            return true;
        }
        return false;
    }

    /**
     * Get a building state by entity ID.
     * @param entityId - The entity ID of the building
     * @returns The building state, or undefined if not found
     */
    getBuildingState(entityId: number): BuildingState | undefined {
        return this.entityProvider?.getEntity(entityId)?.construction;
    }

    /**
     * Check if a building state exists.
     * @param entityId - The entity ID of the building
     */
    hasBuildingState(entityId: number): boolean {
        return this.entityProvider?.getEntity(entityId)?.construction !== undefined;
    }

    /**
     * Get all building states.
     * For iteration, use getAllBuildingIds() for deterministic order.
     */
    *getAllBuildingStates(): IterableIterator<BuildingState> {
        for (const entity of this.entityProvider!.entities) {
            if (entity.construction) {
                yield entity.construction;
            }
        }
    }

    /**
     * Get all building entity IDs in sorted order (for deterministic iteration).
     */
    getAllBuildingIds(): number[] {
        const ids: number[] = [];
        for (const entity of this.entityProvider!.entities) {
            if (entity.construction) {
                ids.push(entity.id);
            }
        }
        return ids.sort((a, b) => a - b);
    }

    /**
     * Get the underlying states as a readonly map (for renderers).
     * Note: This creates a new Map on each call - prefer getBuildingState() for single lookups.
     */
    get buildingStates(): ReadonlyMap<number, BuildingState> {
        const map = new Map<number, BuildingState>();
        for (const entity of this.entityProvider!.entities) {
            if (entity.construction) {
                map.set(entity.id, entity.construction);
            }
        }
        return map;
    }

    /**
     * Get count of buildings in a specific phase.
     */
    getCountByPhase(phase: BuildingConstructionPhase): number {
        let count = 0;
        for (const entity of this.entityProvider!.entities) {
            if (entity.construction?.phase === phase) count++;
        }
        return count;
    }

    /**
     * Clear all building states.
     * Useful for testing or game reset.
     */
    clear(): void {
        for (const entity of this.entityProvider!.entities) {
            delete entity.construction;
        }
    }

    /**
     * Restore a building state from serialized data (used by persistence).
     */
    restoreBuildingState(data: {
        entityId: number;
        buildingType: BuildingType;
        tileX: number;
        tileY: number;
        phase: BuildingConstructionPhase;
        phaseProgress: number;
        totalDuration: number;
        elapsedTime: number;
        terrainModified: boolean;
    }): void {
        const entity = this.entityProvider?.getEntity(data.entityId);
        if (!entity) {
            throw new Error(`Cannot restore building state: entity ${data.entityId} not found`);
        }

        // Store state on entity (RFC: Entity-Owned State)
        entity.construction = {
            entityId: data.entityId,
            buildingType: data.buildingType,
            phase: data.phase,
            phaseProgress: data.phaseProgress,
            totalDuration: data.totalDuration,
            elapsedTime: data.elapsedTime,
            tileX: data.tileX,
            tileY: data.tileY,
            originalTerrain: null, // Not persisted - terrain is already modified
            terrainModified: data.terrainModified,
        };
    }
}

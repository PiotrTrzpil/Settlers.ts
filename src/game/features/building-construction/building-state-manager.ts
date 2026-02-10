/**
 * BuildingStateManager - Manages all building construction states.
 * Provides CRUD operations for building states.
 *
 * Following the Manager pattern (Rule 4.1):
 * - Manager owns state, provides CRUD
 * - System handles per-frame behavior
 */

import type { EventBus } from '../../event-bus';
import { BuildingType } from '../../buildings/types';
import { BuildingConstructionPhase, type BuildingState } from './types';

/** Default building construction duration in seconds */
export const DEFAULT_CONSTRUCTION_DURATION = 10;

/**
 * Manages building construction states for all buildings.
 * Provides CRUD operations and queries.
 */
export class BuildingStateManager {
    /** Map of entity ID -> building state */
    private readonly states: Map<number, BuildingState> = new Map();

    /** Event bus for emitting building events */
    private eventBus: EventBus | undefined;

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
        this.states.set(entityId, state);
        return state;
    }

    /**
     * Remove a building state.
     * @param entityId - The entity ID of the building
     * @returns true if the state was removed
     */
    removeBuildingState(entityId: number): boolean {
        return this.states.delete(entityId);
    }

    /**
     * Get a building state by entity ID.
     * @param entityId - The entity ID of the building
     * @returns The building state, or undefined if not found
     */
    getBuildingState(entityId: number): BuildingState | undefined {
        return this.states.get(entityId);
    }

    /**
     * Check if a building state exists.
     * @param entityId - The entity ID of the building
     */
    hasBuildingState(entityId: number): boolean {
        return this.states.has(entityId);
    }

    /**
     * Get all building states.
     * For iteration, use getAllBuildingIds() for deterministic order.
     */
    getAllBuildingStates(): IterableIterator<BuildingState> {
        return this.states.values();
    }

    /**
     * Get all building entity IDs in sorted order (for deterministic iteration).
     */
    getAllBuildingIds(): number[] {
        return [...this.states.keys()].sort((a, b) => a - b);
    }

    /**
     * Get the underlying states map (read-only access for renderers).
     */
    get buildingStates(): ReadonlyMap<number, BuildingState> {
        return this.states;
    }

    /**
     * Get count of buildings in a specific phase.
     */
    getCountByPhase(phase: BuildingConstructionPhase): number {
        let count = 0;
        for (const state of this.states.values()) {
            if (state.phase === phase) count++;
        }
        return count;
    }

    /**
     * Clear all building states.
     * Useful for testing or game reset.
     */
    clear(): void {
        this.states.clear();
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
        const state: BuildingState = {
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
        this.states.set(data.entityId, state);
    }
}

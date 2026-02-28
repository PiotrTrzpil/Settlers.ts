/**
 * BuildingStateManager - Manages all building construction states.
 * Provides CRUD operations for building states.
 *
 * Following the Manager pattern (Rule 4.1):
 * - Manager owns state, provides CRUD
 * - System handles per-frame behavior
 */

import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import { BuildingType } from '../../buildings/types';
import { Race } from '../../race';
import { BuildingConstructionPhase, type BuildingState } from './types';
import { EntityType, type EntityProvider } from '../../entity';

/** Default building construction duration in seconds */
export const DEFAULT_CONSTRUCTION_DURATION = 10;

/**
 * Configuration for BuildingStateManager dependencies.
 */
export interface BuildingStateManagerConfig {
    entityProvider: EntityProvider;
    eventBus: EventBus;
}

/**
 * Manages building construction states for all buildings.
 * Provides CRUD operations and queries.
 */
export class BuildingStateManager {
    /** Entity provider for accessing entities */
    private readonly entityProvider: EntityProvider;

    /** Event bus for emitting building events */
    private readonly eventBus: EventBus;

    /** Internal state storage: entityId -> BuildingState */
    private readonly states = new Map<number, BuildingState>();

    /** Tracked event subscriptions for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: BuildingStateManagerConfig) {
        this.entityProvider = config.entityProvider;
        this.eventBus = config.eventBus;
    }

    /**
     * Subscribe to entity lifecycle events.
     * Creates building states for new buildings and removes them on entity removal.
     */
    registerEvents(eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        this.subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, type, subType, x, y }) => {
            if (type === EntityType.Building) {
                const entity = this.entityProvider.getEntity(entityId);
                if (!entity) throw new Error(`BuildingStateManager: entity ${entityId} not found after entity:created`);
                this.createBuildingState(entityId, subType as BuildingType, x, y, entity.race);
            }
        });

        cleanupRegistry.onEntityRemoved(entityId => this.removeBuildingState(entityId));
    }

    /** Unsubscribe from all tracked events. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
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
        race: Race,
        totalDuration: number = DEFAULT_CONSTRUCTION_DURATION
    ): BuildingState {
        if (!this.entityProvider.getEntity(entityId)) {
            throw new Error(`Cannot create building state: entity ${entityId} not found`);
        }

        const state: BuildingState = {
            entityId,
            buildingType,
            race,
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
    *getAllBuildingStates(): IterableIterator<BuildingState> {
        yield* this.states.values();
    }

    /**
     * Get all building entity IDs in sorted order (for deterministic iteration).
     */
    getAllBuildingIds(): number[] {
        return [...this.states.keys()].sort((a, b) => a - b);
    }

    /**
     * Get the underlying states as a readonly map (for renderers).
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
        race: Race;
        tileX: number;
        tileY: number;
        phase: BuildingConstructionPhase;
        phaseProgress: number;
        totalDuration: number;
        elapsedTime: number;
        terrainModified: boolean;
    }): void {
        if (!this.entityProvider.getEntity(data.entityId)) {
            console.warn(`Cannot restore building state: entity ${data.entityId} not found, skipping`);
            return;
        }

        this.states.set(data.entityId, {
            entityId: data.entityId,
            buildingType: data.buildingType,
            race: data.race,
            phase: data.phase,
            phaseProgress: data.phaseProgress,
            totalDuration: data.totalDuration,
            elapsedTime: data.elapsedTime,
            tileX: data.tileX,
            tileY: data.tileY,
            originalTerrain: null, // Not persisted - terrain is already modified
            terrainModified: data.terrainModified,
        });
    }
}

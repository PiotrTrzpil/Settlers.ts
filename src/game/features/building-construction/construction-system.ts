/**
 * BuildingConstructionSystem - Per-frame construction behavior as a TickSystem.
 *
 * Following the Manager/System pattern (Rule 4.1):
 * - BuildingStateManager owns state, provides CRUD
 * - This System handles per-frame behavior, queries the Manager
 *
 * Listens for building:removed events to restore terrain.
 */

import type { TickSystem } from '../../tick-system';
import type { GameState } from '../../game-state';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { BuildingConstructionPhase, type BuildingState, type TerrainContext } from './types';
import { determinePhase, calculatePhaseProgress } from './internal/phase-transitions';
import { captureOriginalTerrain, applyTerrainLeveling, restoreOriginalTerrain } from './terrain';
import type { BuildingStateManager } from './building-state-manager';
import type { Command, CommandResult } from '../../commands';

/**
 * Configuration for BuildingConstructionSystem dependencies.
 */
export interface BuildingConstructionSystemConfig {
    gameState: GameState;
    buildingStateManager: BuildingStateManager;
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Building construction tick system.
 * Updates all building construction states each tick.
 * Handles terrain modification, phase transitions, and unit spawning.
 */
export class BuildingConstructionSystem implements TickSystem {
    private readonly state: GameState;
    private readonly manager: BuildingStateManager;
    private readonly executeCommand: (cmd: Command) => CommandResult;
    private terrainContext: TerrainContext | undefined; // OK: optional, set via setter
    private eventBus!: EventBus; // MUST be set via registerEvents

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: BuildingConstructionSystemConfig) {
        this.state = config.gameState;
        this.manager = config.buildingStateManager;
        this.executeCommand = config.executeCommand;
    }

    /** Set terrain context for terrain modification during construction */
    setTerrainContext(ctx: TerrainContext | undefined): void {
        this.terrainContext = ctx;
    }

    /** Register event handlers with the event bus */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.subscriptions.subscribe(eventBus, 'building:removed', ({ buildingState }) => {
            this.onBuildingRemoved(buildingState as BuildingState);
        });
        // Listen for building:completed to spawn units via command pipeline
        this.subscriptions.subscribe(eventBus, 'building:completed', ({ entityId }) => {
            this.executeCommand({ type: 'spawn_building_units', buildingEntityId: entityId as number });
        });
    }

    /** Unregister event handlers - called during cleanup */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Cleanup for HMR and game exit */
    destroy(): void {
        this.unregisterEvents();
    }

    /** Called by GameLoop each tick */
    tick(dt: number): void {
        let terrainModified = false;

        // Use manager's sorted IDs for deterministic iteration order
        for (const entityId of this.manager.getAllBuildingIds()) {
            const buildingState = this.manager.getBuildingState(entityId);
            if (!buildingState || buildingState.phase === BuildingConstructionPhase.Completed) continue;

            if (this.updateSingleBuilding(buildingState, dt)) {
                terrainModified = true;
            }
        }

        if (terrainModified && this.terrainContext?.onTerrainModified) {
            this.terrainContext.onTerrainModified();
        }
    }

    /** Handle building removal - restore terrain */
    private onBuildingRemoved(buildingState: BuildingState): void {
        if (!this.terrainContext) return;
        const { groundType, groundHeight, mapSize } = this.terrainContext;
        restoreOriginalTerrain(buildingState, groundType, groundHeight, mapSize);
    }

    /** Update a single building's construction state */
    private updateSingleBuilding(buildingState: BuildingState, dt: number): boolean {
        const previousPhase = buildingState.phase;

        buildingState.elapsedTime += dt;
        const elapsedFraction = Math.min(buildingState.elapsedTime / buildingState.totalDuration, 1.0);

        const newPhase = determinePhase(elapsedFraction);
        buildingState.phase = newPhase;
        buildingState.phaseProgress = calculatePhaseProgress(elapsedFraction, newPhase);

        let terrainModified = false;
        if (this.terrainContext) {
            this.handleTerrainCapture(buildingState, newPhase);
            terrainModified = this.handleTerrainLeveling(buildingState, newPhase);
            terrainModified = this.handleTerrainFinalization(buildingState, previousPhase, newPhase) || terrainModified;
        }

        if (newPhase === BuildingConstructionPhase.Completed && previousPhase !== BuildingConstructionPhase.Completed) {
            // Emit event - unit spawning is handled by the building:completed event listener
            this.eventBus!.emit('building:completed', {
                entityId: buildingState.entityId,
                buildingState,
            });
        }

        return terrainModified;
    }

    /** Handle terrain leveling initialization for a building */
    private handleTerrainCapture(buildingState: BuildingState, newPhase: BuildingConstructionPhase): void {
        if (newPhase !== BuildingConstructionPhase.TerrainLeveling) return;
        if (buildingState.originalTerrain) return;
        if (!this.terrainContext) return;

        const { groundType, groundHeight, mapSize } = this.terrainContext;
        buildingState.originalTerrain = captureOriginalTerrain(buildingState, groundType, groundHeight, mapSize);
    }

    /** Handle active terrain leveling during construction */
    private handleTerrainLeveling(buildingState: BuildingState, newPhase: BuildingConstructionPhase): boolean {
        if (newPhase !== BuildingConstructionPhase.TerrainLeveling) return false;
        if (!buildingState.originalTerrain) return false;
        if (!this.terrainContext) return false;

        const { groundType, groundHeight, mapSize } = this.terrainContext;
        return applyTerrainLeveling(buildingState, groundType, groundHeight, mapSize, buildingState.phaseProgress);
    }

    /** Finalize terrain when transitioning out of TerrainLeveling phase */
    private handleTerrainFinalization(
        buildingState: BuildingState,
        previousPhase: BuildingConstructionPhase,
        newPhase: BuildingConstructionPhase
    ): boolean {
        if (previousPhase !== BuildingConstructionPhase.TerrainLeveling) return false;
        if (newPhase <= BuildingConstructionPhase.TerrainLeveling) return false;
        if (!buildingState.originalTerrain || buildingState.terrainModified) return false;
        if (!this.terrainContext) return false;

        buildingState.terrainModified = true;
        const { groundType, groundHeight, mapSize } = this.terrainContext;
        return applyTerrainLeveling(buildingState, groundType, groundHeight, mapSize, 1.0);
    }
}

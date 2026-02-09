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
import type { EventBus } from '../../event-bus';
import { EntityType } from '../../entity';
import { BuildingType } from '../../buildings/types';
import { UnitType } from '../../unit-types';
import { isPassable } from '../placement';
import { BuildingConstructionPhase, type BuildingState, type BuildingSpawnConfig, type TerrainContext } from './types';
import { determinePhase, calculatePhaseProgress } from './internal/phase-transitions';
import { captureOriginalTerrain, applyTerrainLeveling, restoreOriginalTerrain } from './terrain';
import type { BuildingStateManager } from './building-state-manager';

/**
 * Which unit type (and count) each building spawns when construction completes.
 * The Barrack produces soldiers, residence buildings produce settlers, etc.
 * Buildings not listed here don't spawn units on completion.
 */
export const BUILDING_SPAWN_ON_COMPLETE: Record<number, BuildingSpawnConfig | undefined> = {
    [BuildingType.Barrack]: { unitType: UnitType.Swordsman, count: 3 },
    [BuildingType.ResidenceSmall]: { unitType: UnitType.Carrier, count: 2 },
    [BuildingType.ResidenceMedium]: { unitType: UnitType.Carrier, count: 4 },
    [BuildingType.ResidenceBig]: { unitType: UnitType.Carrier, count: 6 },
};

/**
 * Configuration for BuildingConstructionSystem dependencies.
 */
export interface BuildingConstructionSystemConfig {
    gameState: GameState;
    buildingStateManager: BuildingStateManager;
}

/**
 * Building construction tick system.
 * Updates all building construction states each tick.
 * Handles terrain modification, phase transitions, and unit spawning.
 */
export class BuildingConstructionSystem implements TickSystem {
    private readonly state: GameState;
    private readonly manager: BuildingStateManager;
    private terrainContext: TerrainContext | undefined;
    private eventBus: EventBus | undefined;

    constructor(config: BuildingConstructionSystemConfig) {
        this.state = config.gameState;
        this.manager = config.buildingStateManager;
    }

    /** Set terrain context for terrain modification during construction */
    setTerrainContext(ctx: TerrainContext | undefined): void {
        this.terrainContext = ctx;
    }

    /** Register event handlers with the event bus */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        eventBus.on('building:removed', ({ buildingState }) => {
            this.onBuildingRemoved(buildingState);
        });
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
            terrainModified = this.handleTerrainFinalization(
                buildingState, previousPhase, newPhase
            ) || terrainModified;
        }

        if (newPhase === BuildingConstructionPhase.Completed && previousPhase !== BuildingConstructionPhase.Completed) {
            this.eventBus?.emit('building:completed', {
                entityId: buildingState.entityId,
                buildingState,
            });
            this.spawnUnitsOnBuildingComplete(buildingState);
        }

        return terrainModified;
    }

    /** Handle terrain leveling initialization for a building */
    private handleTerrainCapture(
        buildingState: BuildingState,
        newPhase: BuildingConstructionPhase
    ): void {
        if (newPhase !== BuildingConstructionPhase.TerrainLeveling) return;
        if (buildingState.originalTerrain) return;
        if (!this.terrainContext) return;

        const { groundType, groundHeight, mapSize } = this.terrainContext;
        buildingState.originalTerrain = captureOriginalTerrain(
            buildingState, groundType, groundHeight, mapSize
        );
    }

    /** Handle active terrain leveling during construction */
    private handleTerrainLeveling(
        buildingState: BuildingState,
        newPhase: BuildingConstructionPhase
    ): boolean {
        if (newPhase !== BuildingConstructionPhase.TerrainLeveling) return false;
        if (!buildingState.originalTerrain) return false;
        if (!this.terrainContext) return false;

        const { groundType, groundHeight, mapSize } = this.terrainContext;
        return applyTerrainLeveling(
            buildingState, groundType, groundHeight, mapSize,
            buildingState.phaseProgress
        );
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
        return applyTerrainLeveling(
            buildingState, groundType, groundHeight, mapSize, 1.0
        );
    }

    /** Check if a tile is valid for spawning a unit */
    private isValidSpawnTile(x: number, y: number): boolean {
        if (this.terrainContext) {
            const { mapSize, groundType } = this.terrainContext;
            if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) return false;
            if (!isPassable(groundType[mapSize.toIndex(x, y)])) return false;
        }
        return !this.state.getEntityAt(x, y);
    }

    /** Generate ring perimeter tiles (only the edge of a square ring) */
    private *getRingTiles(cx: number, cy: number, radius: number): Generator<{ x: number; y: number }> {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                    yield { x: cx + dx, y: cy + dy };
                }
            }
        }
    }

    /**
     * Spawn units adjacent to a building that just completed construction.
     * Uses BUILDING_SPAWN_ON_COMPLETE to determine which unit type and count to spawn.
     */
    private spawnUnitsOnBuildingComplete(buildingState: BuildingState): void {
        const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingState.buildingType];
        if (!spawnDef) return;

        const entity = this.state.getEntity(buildingState.entityId);
        if (!entity) return;

        const { tileX: bx, tileY: by } = buildingState;
        let spawned = 0;

        for (let radius = 1; radius <= 4 && spawned < spawnDef.count; radius++) {
            for (const tile of this.getRingTiles(bx, by, radius)) {
                if (spawned >= spawnDef.count) break;
                if (!this.isValidSpawnTile(tile.x, tile.y)) continue;

                const spawnedEntity = this.state.addEntity(
                    EntityType.Unit, spawnDef.unitType, tile.x, tile.y,
                    entity.player, spawnDef.selectable
                );

                this.eventBus?.emit('unit:spawned', {
                    entityId: spawnedEntity.id,
                    unitType: spawnDef.unitType,
                    x: tile.x,
                    y: tile.y,
                    player: entity.player,
                });

                spawned++;
            }
        }
    }
}

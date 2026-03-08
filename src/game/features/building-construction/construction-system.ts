/**
 * BuildingConstructionSystem - Per-frame construction behavior as a TickSystem.
 *
 * Following the Manager/System pattern (Rule 4.1):
 * - ConstructionSiteManager owns state, provides CRUD
 * - This System handles per-frame behavior, queries the Manager
 *
 * Phase progression is event-driven:
 * - construction:diggingStarted  → TerrainLeveling
 * - construction:levelingComplete → Evacuating (if units on footprint) or WaitingForBuilders
 * - construction:buildingStarted  → ConstructionRising
 * - construction:progressComplete → CompletedRising (progress-based countdown)
 *
 * Listens for building:removed events to restore terrain on construction cancellation.
 * Listens for building:completed to spawn units once the CompletedRising timer fires.
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { EntityType, BuildingType, tileKey, getBuildingFootprint } from '../../entity';
import { getBuildingDoorCorridor } from '../../buildings/types';
import { BuildingConstructionPhase, type TerrainContext, type ConstructionSite } from './types';
import { COMPLETED_RISING_DURATION } from './internal/phase-transitions';
import { captureOriginalTerrain, restoreOriginalTerrain, applySingleTileLeveling } from './terrain';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { Command, CommandResult } from '../../commands';
import { BUILDING_SPAWN_ON_COMPLETE } from './spawn-units';
import type { ResidenceSpawnerSystem } from './residence-spawner';
import { ringTiles } from '../../systems/spatial-search';

/**
 * Configuration for BuildingConstructionSystem dependencies.
 */
export interface BuildingConstructionSystemConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Building construction tick system.
 * Handles terrain modification, CompletedRising countdown, and unit spawning.
 * Phase transitions are driven by construction events from ConstructionSiteManager.
 */
export class BuildingConstructionSystem implements TickSystem {
    private readonly state: GameState;
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly executeCommand: (cmd: Command) => CommandResult;
    private terrainContext: TerrainContext | undefined; // OK: optional, set via setter
    private readonly eventBus: EventBus;
    private residenceSpawner: ResidenceSpawnerSystem | null = null;

    /**
     * Buildings awaiting evacuation before footprint block is restored.
     * Maps buildingId → set of unit entity IDs that were on the footprint when leveling completed.
     * Footprint block is deferred until all tracked units leave the footprint tiles.
     */
    private readonly pendingEvacuations = new Map<number, Set<number>>();

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: BuildingConstructionSystemConfig) {
        this.state = config.gameState;
        this.eventBus = config.eventBus;
        this.constructionSiteManager = config.constructionSiteManager;
        this.executeCommand = config.executeCommand;
    }

    /** Set terrain context for terrain modification during construction */
    setTerrainContext(ctx: TerrainContext | undefined): void {
        this.terrainContext = ctx;
    }

    /** Set the residence spawner for interval-based carrier spawning */
    setResidenceSpawner(spawner: ResidenceSpawnerSystem): void {
        this.residenceSpawner = spawner;
    }

    /** Register event handlers with the event bus */
    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'building:removed', ({ entityId }) =>
            this.onBuildingRemoved(entityId)
        );

        // Listen for building:completed to spawn units.
        // Always execute spawn_building_units (handles construction workers + dedicated workers).
        // Additionally, register interval-based carrier spawning for residences.
        this.subscriptions.subscribe(
            this.eventBus,
            'building:completed',
            ({ entityId, buildingType, placedCompleted, spawnWorker }) => {
                this.executeCommand({
                    type: 'spawn_building_units',
                    buildingEntityId: entityId,
                    placedCompleted,
                    spawnWorker,
                });
                const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingType];
                if (spawnDef?.spawnInterval && this.residenceSpawner) {
                    this.residenceSpawner.register(entityId, spawnDef);
                }
            }
        );

        // construction:diggingStarted → TerrainLeveling (capture terrain if needed)
        this.subscriptions.subscribe(this.eventBus, 'construction:diggingStarted', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            site.phase = BuildingConstructionPhase.TerrainLeveling;
            if (!site.terrain.originalTerrain && this.terrainContext) {
                const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
                site.terrain.originalTerrain = captureOriginalTerrain(site, groundType, groundHeight, mapSize);
            }
            // Populate per-tile tracking from captured terrain
            this.constructionSiteManager.populateUnleveledTiles(buildingId);
        });

        // construction:tileCompleted → apply single tile terrain change
        this.subscriptions.subscribe(
            this.eventBus,
            'construction:tileCompleted',
            ({ tileX, tileY, targetHeight, isFootprint }) => {
                if (!this.terrainContext) return;
                const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
                const modified = applySingleTileLeveling(
                    tileX,
                    tileY,
                    targetHeight,
                    isFootprint,
                    groundType,
                    groundHeight,
                    mapSize
                );
                if (modified && this.terrainContext.onTerrainModified) {
                    this.terrainContext.onTerrainModified();
                }
            }
        );

        // construction:levelingComplete → WaitingForBuilders (all tiles already leveled individually)
        // If units are still on the footprint, defer blocking and evacuate them first.
        this.subscriptions.subscribe(this.eventBus, 'construction:levelingComplete', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            // Mark terrain as fully modified (individual tiles already applied via tileCompleted events)
            if (site.terrain.originalTerrain && !site.terrain.modified) {
                site.terrain.modified = true;
            }

            const unitsOnFootprint = this.findUnitsOnFootprint(buildingId);
            if (unitsOnFootprint.size > 0) {
                site.phase = BuildingConstructionPhase.Evacuating;
                this.pendingEvacuations.set(buildingId, unitsOnFootprint);
                this.evacuateUnits(buildingId, unitsOnFootprint);
            } else {
                site.phase = BuildingConstructionPhase.WaitingForBuilders;
                this.state.restoreBuildingFootprintBlock(buildingId);
            }
        });

        // construction:buildingStarted → ConstructionRising
        this.subscriptions.subscribe(this.eventBus, 'construction:buildingStarted', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            site.phase = BuildingConstructionPhase.ConstructionRising;
        });

        // construction:progressComplete → CompletedRising (progress-based countdown)
        this.subscriptions.subscribe(this.eventBus, 'construction:progressComplete', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            site.phase = BuildingConstructionPhase.CompletedRising;
            site.completedRisingProgress = 0.0;
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
        for (const entityId of this.constructionSiteManager.getAllSiteIds()) {
            try {
                this.tickSite(entityId, dt);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                console.error(`[BuildingConstructionSystem] Error ticking site ${entityId}:`, err);
            }
        }
    }

    private tickSite(entityId: number, dt: number): void {
        const site = this.constructionSiteManager.getSite(entityId);
        if (!site) return;

        if (site.phase === BuildingConstructionPhase.Evacuating) {
            this.tickEvacuation(entityId, site);
        } else if (site.phase === BuildingConstructionPhase.CompletedRising) {
            this.tickCompletedRising(entityId, site, dt);
        }
    }

    /** Advance CompletedRising progress and transition to Completed when done. */
    private tickCompletedRising(entityId: number, site: ConstructionSite, dt: number): void {
        site.completedRisingProgress += dt / COMPLETED_RISING_DURATION;
        if (site.completedRisingProgress >= 1.0) {
            site.phase = BuildingConstructionPhase.Completed;
            // Extract site fields before removal — game-services.ts removes the site in its handler
            const { buildingType, race } = site;
            this.eventBus.emit('building:completed', { entityId, buildingType, race, spawnWorker: true });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Footprint evacuation
    // ─────────────────────────────────────────────────────────────

    /**
     * Find all unit entity IDs standing on the building's non-door footprint tiles.
     */
    private findUnitsOnFootprint(buildingId: number): Set<number> {
        const entity = this.state.getEntityOrThrow(buildingId, 'findUnitsOnFootprint');
        const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType, entity.race);
        const passableKeys = getBuildingDoorCorridor(
            entity.x,
            entity.y,
            entity.subType as BuildingType,
            entity.race,
            footprint
        );
        const unitIds = new Set<number>();

        for (const tile of footprint) {
            const key = tileKey(tile.x, tile.y);
            if (passableKeys.has(key)) continue; // door corridor — always passable
            const occupant = this.state.tileOccupancy.get(key);
            if (occupant === undefined) continue;
            // Only evacuate units, not the building itself or piles
            const occupantEntity = this.state.getEntityOrThrow(occupant, 'findUnitsOnFootprint');
            if (occupantEntity.type === EntityType.Unit) {
                unitIds.add(occupant);
            }
        }
        return unitIds;
    }

    /**
     * Issue move commands to evacuate units from a building's footprint.
     * Each unit is directed to the nearest free tile outside the footprint.
     */
    private evacuateUnits(buildingId: number, unitIds: Set<number>): void {
        const building = this.state.getEntityOrThrow(buildingId, 'evacuateUnits');
        const footprint = getBuildingFootprint(building.x, building.y, building.subType as BuildingType, building.race);
        const footprintKeys = new Set<string>();
        for (const tile of footprint) {
            footprintKeys.add(tileKey(tile.x, tile.y));
        }

        for (const unitId of unitIds) {
            const unit = this.state.getEntityOrThrow(unitId, 'evacuateUnits');
            const target = this.findNearestFreeOutside(unit.x, unit.y, footprintKeys);
            if (target) {
                this.executeCommand({ type: 'move_unit', entityId: unitId, targetX: target.x, targetY: target.y });
            }
        }
    }

    /**
     * Find the nearest free tile that is NOT part of the given footprint.
     */
    private findNearestFreeOutside(
        cx: number,
        cy: number,
        footprintKeys: Set<string>
    ): { x: number; y: number } | null {
        for (let radius = 1; radius <= 10; radius++) {
            for (const tile of ringTiles(cx, cy, radius)) {
                const key = tileKey(tile.x, tile.y);
                if (footprintKeys.has(key)) continue;
                if (this.state.getEntityAt(tile.x, tile.y)) continue;
                return tile;
            }
        }
        return null;
    }

    /**
     * Check if all evacuating units have left the footprint.
     * Once clear, restore footprint block and transition to WaitingForBuilders.
     */
    private tickEvacuation(buildingId: number, site: ConstructionSite): void {
        const unitIds = this.pendingEvacuations.get(buildingId)!;

        // Building may be cancelled mid-evacuation — clean up and bail
        const building = this.state.getEntity(buildingId);
        if (!building) {
            this.pendingEvacuations.delete(buildingId);
            return;
        }

        // Build set of blocked (non-door) footprint tile keys
        const footprint = getBuildingFootprint(building.x, building.y, building.subType as BuildingType, building.race);
        const passableKeys = getBuildingDoorCorridor(
            building.x,
            building.y,
            building.subType as BuildingType,
            building.race,
            footprint
        );
        const blockedKeys = new Set<string>();
        for (const tile of footprint) {
            const key = tileKey(tile.x, tile.y);
            if (!passableKeys.has(key)) blockedKeys.add(key);
        }

        // Remove units that have cleared the footprint or died since evacuation started
        for (const unitId of [...unitIds]) {
            const unit = this.state.getEntity(unitId); // unit may have died between ticks
            if (!unit || !blockedKeys.has(tileKey(unit.x, unit.y))) {
                unitIds.delete(unitId);
            }
        }

        if (unitIds.size === 0) {
            this.pendingEvacuations.delete(buildingId);
            site.phase = BuildingConstructionPhase.WaitingForBuilders;
            this.state.restoreBuildingFootprintBlock(buildingId);
        }
    }

    /** Handle building removal — restore terrain and clean up pending evacuation */
    private onBuildingRemoved(entityId: number): void {
        this.pendingEvacuations.delete(entityId);
        const site = this.constructionSiteManager.getSite(entityId);
        if (!site || !site.terrain.originalTerrain) return;
        if (!this.terrainContext) return;
        const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
        const modified = restoreOriginalTerrain(site.terrain.originalTerrain, groundType, groundHeight, mapSize);
        if (modified && this.terrainContext.onTerrainModified) {
            this.terrainContext.onTerrainModified();
        }
    }
}

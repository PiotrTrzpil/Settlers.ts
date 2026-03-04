/**
 * BuildingConstructionSystem - Per-frame construction behavior as a TickSystem.
 *
 * Following the Manager/System pattern (Rule 4.1):
 * - ConstructionSiteManager owns state, provides CRUD
 * - This System handles per-frame behavior, queries the Manager
 *
 * Phase progression is event-driven:
 * - construction:diggingStarted  → TerrainLeveling
 * - construction:levelingComplete → WaitingForBuilders (terrain finalized)
 * - construction:buildingStarted  → ConstructionRising
 * - construction:progressComplete → CompletedRising (timed countdown)
 *
 * Listens for building:removed events to restore terrain on construction cancellation.
 * Listens for building:completed to spawn units once the CompletedRising timer fires.
 */

import type { TickSystem } from '../../tick-system';
import type { GameState } from '../../game-state';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { BuildingConstructionPhase, type TerrainContext, type ConstructionSite } from './types';
import { COMPLETED_RISING_DURATION } from './internal/phase-transitions';
import { captureOriginalTerrain, applyTerrainLeveling, restoreOriginalTerrain } from './terrain';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { Command, CommandResult } from '../../commands';
import { BUILDING_SPAWN_ON_COMPLETE } from './spawn-units';
import type { ResidenceSpawnerSystem } from './residence-spawner';

/**
 * Configuration for BuildingConstructionSystem dependencies.
 */
export interface BuildingConstructionSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
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

    /** Remaining time (seconds) for buildings in CompletedRising phase */
    private readonly completedRisingTimers = new Map<number, number>();

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
            if (!site.originalTerrain && this.terrainContext) {
                const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
                site.originalTerrain = captureOriginalTerrain(site, groundType, groundHeight, mapSize);
            }
        });

        // construction:levelingComplete → WaitingForBuilders (finalize terrain at 1.0)
        this.subscriptions.subscribe(this.eventBus, 'construction:levelingComplete', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            site.phase = BuildingConstructionPhase.WaitingForBuilders;
            // Building structure starts rising — footprint is no longer walkable.
            this.state.restoreBuildingFootprintBlock(buildingId);
            if (this.terrainContext && site.originalTerrain && !site.terrainModified) {
                site.terrainModified = true;
                const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
                applyTerrainLeveling(site, groundType, groundHeight, mapSize, 1.0, site.originalTerrain);
                if (this.terrainContext.onTerrainModified) {
                    this.terrainContext.onTerrainModified();
                }
            }
        });

        // construction:buildingStarted → ConstructionRising
        this.subscriptions.subscribe(this.eventBus, 'construction:buildingStarted', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            site.phase = BuildingConstructionPhase.ConstructionRising;
        });

        // construction:progressComplete → CompletedRising (start countdown timer)
        this.subscriptions.subscribe(this.eventBus, 'construction:progressComplete', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) return;
            site.phase = BuildingConstructionPhase.CompletedRising;
            this.completedRisingTimers.set(buildingId, COMPLETED_RISING_DURATION);
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

        try {
            for (const entityId of this.constructionSiteManager.getAllSiteIds()) {
                terrainModified = this.tickSite(entityId, dt) || terrainModified;
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            console.error('[BuildingConstructionSystem] Error in tick:', err);
        }

        if (terrainModified && this.terrainContext?.onTerrainModified) {
            this.terrainContext.onTerrainModified();
        }
    }

    /** Tick a single construction site. Returns true if terrain was modified. */
    private tickSite(entityId: number, dt: number): boolean {
        const site = this.constructionSiteManager.getSite(entityId);
        if (!site) return false;

        try {
            if (site.phase === BuildingConstructionPhase.TerrainLeveling) {
                return this.tickTerrainLeveling(site);
            } else if (site.phase === BuildingConstructionPhase.CompletedRising) {
                this.tickCompletedRising(entityId, site, dt);
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            console.error(`[BuildingConstructionSystem] Error ticking site ${entityId}:`, err);
        }
        return false;
    }

    /** Apply incremental terrain leveling for a building in TerrainLeveling phase. */
    private tickTerrainLeveling(site: ConstructionSite): boolean {
        if (!this.terrainContext || !site.originalTerrain) return false;
        const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
        return applyTerrainLeveling(
            site,
            groundType,
            groundHeight,
            mapSize,
            site.levelingProgress,
            site.originalTerrain
        );
    }

    /** Count down CompletedRising timer and transition to Completed. */
    private tickCompletedRising(entityId: number, site: ConstructionSite, dt: number): void {
        const remaining = (this.completedRisingTimers.get(entityId) ?? COMPLETED_RISING_DURATION) - dt;
        if (remaining <= 0) {
            this.completedRisingTimers.delete(entityId);
            site.phase = BuildingConstructionPhase.Completed;
            // Extract site fields before removal — game-services.ts removes the site in its handler
            const { buildingType, race } = site;
            this.eventBus.emit('building:completed', { entityId, buildingType, race, spawnWorker: true });
        } else {
            this.completedRisingTimers.set(entityId, remaining);
            site.completedRisingProgress = 1 - remaining / COMPLETED_RISING_DURATION;
        }
    }

    /** Handle building removal - restore terrain and clean up timers */
    private onBuildingRemoved(entityId: number): void {
        this.completedRisingTimers.delete(entityId);
        const site = this.constructionSiteManager.getSite(entityId);
        if (!site || !site.originalTerrain) return;
        if (!this.terrainContext) return;
        const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
        const modified = restoreOriginalTerrain(site.originalTerrain, groundType, groundHeight, mapSize);
        if (modified && this.terrainContext.onTerrainModified) {
            this.terrainContext.onTerrainModified();
        }
    }
}

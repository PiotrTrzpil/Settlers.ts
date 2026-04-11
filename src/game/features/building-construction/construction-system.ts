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
 * - construction:progressComplete → building:completed (direct, builder-driven)
 *
 * Listens for building:removed events to restore terrain on construction cancellation.
 * Listens for building:completed to spawn units.
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { EntityType, BuildingType, tileKey, getBuildingFootprint, Tile } from '../../entity';
import { getBuildingBlockArea } from '../../buildings/types';
import { BuildingConstructionPhase, type TerrainContext, type ConstructionSite } from './types';

import { captureOriginalTerrain, restoreOriginalTerrain, applySingleTileLeveling } from './terrain';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { CommandExecutor } from '../../commands';
import { BUILDING_SPAWN_ON_COMPLETE } from './spawn-units';
import type { ResidenceSpawnerSystem } from './residence-spawner';
import type { MapSize } from '@/utilities/map-size';
import { ringTiles } from '../../systems/spatial-search';

/**
 * Configuration for BuildingConstructionSystem dependencies.
 */
export interface BuildingConstructionSystemConfig extends CoreDeps {
    constructionSiteManager: ConstructionSiteManager;
    executeCommand: CommandExecutor;
}

/**
 * Building construction tick system.
 * Handles terrain modification and unit spawning.
 * Phase transitions are driven by construction events from ConstructionSiteManager.
 */
export class BuildingConstructionSystem implements TickSystem {
    private readonly state: GameState;
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly executeCommand: CommandExecutor;
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
        if (ctx) {
            this.rebuildTerrainForRestoredSites(ctx);
        }
    }

    /**
     * Re-run terrain rebuild and worker re-emission for all restored sites.
     * Called via onRestoreComplete after snapshot deserialization — at that point
     * construction sites have been restored but setTerrainContext already ran
     * (before sites existed).
     */
    rebuildAfterRestore(): void {
        if (this.terrainContext) {
            this.rebuildTerrainForRestoredSites(this.terrainContext);
        }
    }

    /**
     * Rebuild terrain state for restored construction sites and re-emit worker-needed events.
     *
     * After deserialize, worker assignments are empty and mid-leveling sites have
     * originalTerrain=null (terrain data isn't persisted). This method:
     * 1. Re-captures terrain from the live map for TerrainLeveling sites
     * 2. Re-emits construction:workerNeeded for all phases that need workers
     */
    private rebuildTerrainForRestoredSites(ctx: TerrainContext): void {
        const { groundType, groundHeight, mapSize } = ctx.terrain;
        // Use getAllSiteIds() — returns a snapshot array, safe to iterate while emitting events that remove sites
        for (const siteId of this.constructionSiteManager.getAllSiteIds()) {
            const site = this.constructionSiteManager.getSite(siteId);
            if (!site) {
                continue;
            } // removed by a previous iteration's building:completed

            this.rebuildSingleSite(site, groundType, groundHeight, mapSize);
        }
    }

    /** Rebuild a single restored construction site: terrain data, completion, or worker re-emission. */
    private rebuildSingleSite(
        site: ConstructionSite,
        groundType: Uint8Array,
        groundHeight: Uint8Array,
        mapSize: MapSize
    ): void {
        // Rebuild terrain for mid-leveling sites
        if (site.phase === BuildingConstructionPhase.TerrainLeveling && !site.terrain.originalTerrain) {
            site.terrain.originalTerrain = captureOriginalTerrain(site, groundType, groundHeight, mapSize);
            this.constructionSiteManager.populateUnleveledTiles(site.buildingId);
            if (site.terrain.complete) {
                site.phase = BuildingConstructionPhase.WaitingForBuilders;
                this.state.restoreBuildingFootprintBlock(site.buildingId);
            }
        }
        // Restore footprint blocking for sites past leveling
        if (site.phase >= BuildingConstructionPhase.WaitingForBuilders) {
            this.state.restoreBuildingFootprintBlock(site.buildingId);
        }

        // Complete buildings that finished construction but site wasn't removed before save
        if (this.tryCompleteRestoredSite(site)) {
            return;
        }

        // Re-emit worker-needed events — worker assignments are empty after restore
        this.reemitWorkerNeeded(site);
    }

    /**
     * If a restored site was already fully constructed (or in a terminal phase),
     * re-emit building:completed so the lifecycle handler removes it.
     * Returns true if the site was completed (and removed).
     */
    private tryCompleteRestoredSite(site: ConstructionSite): boolean {
        const isConstructionDone =
            site.phase === BuildingConstructionPhase.ConstructionRising && site.building.progress >= 1.0;
        const isTerminalPhase =
            site.phase === BuildingConstructionPhase.CompletedRising ||
            site.phase === BuildingConstructionPhase.Completed;

        if (!isConstructionDone && !isTerminalPhase) {
            return false;
        }

        this.eventBus.emit('building:completed', {
            buildingId: site.buildingId,
            buildingType: site.buildingType,
            race: site.race,
            spawnWorker: false, // workers already spawned before save
            level: 'info',
        });
        return true;
    }

    /** Re-emit construction:workerNeeded for a restored site so workers get re-assigned. */
    private reemitWorkerNeeded(site: ConstructionSite): void {
        if (!site.terrain.complete) {
            this.eventBus.emit('construction:workerNeeded', {
                role: 'digger' as const,
                buildingId: site.buildingId,
                x: site.tileX,
                y: site.tileY,
                player: site.player,
            });
        } else if (
            site.phase === BuildingConstructionPhase.WaitingForBuilders ||
            site.phase === BuildingConstructionPhase.ConstructionRising
        ) {
            this.eventBus.emit('construction:workerNeeded', {
                role: 'builder' as const,
                buildingId: site.buildingId,
                x: site.tileX,
                y: site.tileY,
                player: site.player,
            });
        }
    }

    /** Set the residence spawner for interval-based carrier spawning */
    setResidenceSpawner(spawner: ResidenceSpawnerSystem): void {
        this.residenceSpawner = spawner;
    }

    /** Register event handlers with the event bus */
    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'building:removed', ({ buildingId }) =>
            this.onBuildingRemoved(buildingId)
        );

        // Listen for building:completed to spawn units.
        // Always execute spawn_building_units (handles construction workers + dedicated workers).
        // Additionally, register interval-based carrier spawning for residences.
        this.subscriptions.subscribe(
            this.eventBus,
            'building:completed',
            ({ buildingId, buildingType, placedCompleted, spawnWorker }) => {
                this.executeCommand({
                    type: 'spawn_building_units',
                    buildingEntityId: buildingId,
                    placedCompleted,
                    spawnWorker,
                });
                const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingType];
                if (spawnDef?.spawnInterval && this.residenceSpawner) {
                    this.residenceSpawner.register(buildingId, spawnDef);
                }
            }
        );

        // construction:diggingStarted → TerrainLeveling phase transition
        this.subscriptions.subscribe(this.eventBus, 'construction:diggingStarted', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) {
                return;
            }
            site.phase = BuildingConstructionPhase.TerrainLeveling;
        });

        // construction:tileCompleted → apply single tile terrain change
        this.subscriptions.subscribe(
            this.eventBus,
            'construction:tileCompleted',
            ({ x, y, targetHeight, isFootprint }) => {
                if (!this.terrainContext) {
                    return;
                }
                const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
                const modified = applySingleTileLeveling(
                    x,
                    y,
                    targetHeight,
                    isFootprint,
                    groundType,
                    groundHeight,
                    mapSize
                );
                if (modified && this.terrainContext.onTerrainModified) {
                    this.terrainContext.onTerrainModified('leveling', { x, y });
                }
            }
        );

        // construction:levelingComplete → evacuate units from footprint, then block it.
        // Construction piles are placed outside the block area so carriers can always deliver.
        this.subscriptions.subscribe(this.eventBus, 'construction:levelingComplete', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) {
                return;
            }
            // Mark terrain as fully modified (individual tiles already applied via tileCompleted events)
            if (site.terrain.originalTerrain && !site.terrain.modified) {
                site.terrain.modified = true;
            }

            // 1. Find units on footprint BEFORE blocking (footprint still walkable)
            const unitsOnFootprint = this.findUnitsOnFootprint(buildingId);

            // 2. Issue evacuation moves while footprint is still unblocked
            //    (pathfinder can route through footprint tiles to reach the edge)
            if (unitsOnFootprint.size > 0) {
                this.evacuateUnits(buildingId, unitsOnFootprint);
            }

            // 3. Block footprint so no new units path in
            this.state.restoreBuildingFootprintBlock(buildingId);

            // 4. Repath any in-flight units whose paths go through the now-blocked footprint
            //    (exclude evacuating units — they have valid escape paths calculated before blocking)
            const blockArea = getBuildingBlockArea({ x: site.tileX, y: site.tileY }, site.buildingType, site.race);
            const blockKeys = new Set<string>();
            for (const tile of blockArea) {
                blockKeys.add(tileKey(tile));
            }
            this.state.movement.repathUnitsThrough(blockKeys, unitsOnFootprint);

            // 5. Gate: wait for evacuating units to leave before transitioning
            if (unitsOnFootprint.size > 0) {
                site.phase = BuildingConstructionPhase.Evacuating;
                this.pendingEvacuations.set(buildingId, unitsOnFootprint);
            } else {
                site.phase = BuildingConstructionPhase.WaitingForBuilders;
            }
        });

        // construction:buildingStarted → ConstructionRising
        this.subscriptions.subscribe(this.eventBus, 'construction:buildingStarted', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) {
                return;
            }
            site.phase = BuildingConstructionPhase.ConstructionRising;
        });

        // construction:progressComplete → building:completed (builder-driven, no timer)
        this.subscriptions.subscribe(this.eventBus, 'construction:progressComplete', ({ buildingId }) => {
            const site = this.constructionSiteManager.getSite(buildingId);
            if (!site) {
                return;
            }
            const { buildingType, race } = site;
            this.eventBus.emit('building:completed', {
                buildingId,
                buildingType,
                race,
                spawnWorker: true,
                level: 'info',
            });
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

    private tickSite(entityId: number, _dt: number): void {
        const site = this.constructionSiteManager.getSite(entityId);
        if (!site) {
            return;
        }

        if (site.phase === BuildingConstructionPhase.Evacuating) {
            this.tickEvacuation(entityId, site);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Footprint evacuation
    // ─────────────────────────────────────────────────────────────

    /**
     * Find all unit entity IDs standing on any of the building's footprint tiles
     * (including door tiles — idle units must be evacuated before construction rises).
     */
    private findUnitsOnFootprint(buildingId: number): Set<number> {
        const entity = this.state.getEntityOrThrow(buildingId, 'findUnitsOnFootprint');
        const blockArea = getBuildingBlockArea(entity, entity.subType as BuildingType, entity.race);
        const blockKeys = new Set<string>();
        for (const tile of blockArea) {
            blockKeys.add(tileKey(tile));
        }

        // Scan all entities — tileOccupancy only stores one entity per tile and the
        // building owns those tiles, so units that walked onto the footprint via
        // movement are invisible to tileOccupancy.
        const unitIds = new Set<number>();
        for (const e of this.state.entityIndex.query(EntityType.Unit)) {
            if (blockKeys.has(tileKey(e))) {
                unitIds.add(e.id);
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
        const footprint = getBuildingFootprint(building, building.subType as BuildingType, building.race);
        const footprintKeys = new Set<string>();
        for (const tile of footprint) {
            footprintKeys.add(tileKey(tile));
        }

        for (const unitId of unitIds) {
            const unit = this.state.getEntityOrThrow(unitId, 'evacuateUnits');
            const target = this.findNearestFreeOutside(unit, footprintKeys);
            if (target) {
                this.executeCommand({ type: 'move_unit', entityId: unitId, targetX: target.x, targetY: target.y });
            }
        }
    }

    /**
     * Find the nearest free tile that is NOT part of the given footprint.
     */
    private findNearestFreeOutside(center: Tile, footprintKeys: Set<string>): Tile | null {
        for (let radius = 1; radius <= 10; radius++) {
            for (const tile of ringTiles(center, radius)) {
                const key = tileKey(tile);
                if (footprintKeys.has(key)) {
                    continue;
                }
                // Check ground occupancy — buildings own footprint tiles in groundOccupancy
                // but those are filtered by footprintKeys above, so any remaining
                // ground occupant (map object, pile) is a real blocker.
                if (this.state.getGroundEntityAt(tile)) {
                    continue;
                }
                return tile;
            }
        }
        return null;
    }

    /**
     * Gate: wait for all tracked units to leave the footprint before transitioning.
     * No rescan needed — footprint is blocked and in-flight units are repathed
     * before evacuation starts, so no new arrivals are possible.
     */
    private tickEvacuation(buildingId: number, site: ConstructionSite): void {
        const tracked = this.pendingEvacuations.get(buildingId);
        if (!tracked) {
            throw new Error(`No pending evacuation for building ${buildingId} in ConstructionSystem.tickEvacuation`);
        }

        // Building may be cancelled mid-evacuation — clean up and bail
        const building = this.state.getEntity(buildingId);
        if (!building) {
            this.pendingEvacuations.delete(buildingId);
            return;
        }

        // Build block area keys
        const blockArea = getBuildingBlockArea(building, building.subType as BuildingType, building.race);
        const blockKeys = new Set<string>();
        for (const tile of blockArea) {
            blockKeys.add(tileKey(tile));
        }

        // Remove units that have cleared the footprint or died
        for (const unitId of Array.from(tracked)) {
            const unit = this.state.getEntity(unitId);
            if (!unit || !blockKeys.has(tileKey(unit))) {
                tracked.delete(unitId);
            }
        }

        if (tracked.size === 0) {
            this.pendingEvacuations.delete(buildingId);
            site.phase = BuildingConstructionPhase.WaitingForBuilders;
        }
    }

    /** Handle building removal — restore terrain and clean up pending evacuation */
    private onBuildingRemoved(entityId: number): void {
        this.pendingEvacuations.delete(entityId);
        const site = this.constructionSiteManager.getSite(entityId);
        if (!site || !site.terrain.originalTerrain) {
            return;
        }
        if (!this.terrainContext) {
            return;
        }
        const { groundType, groundHeight, mapSize } = this.terrainContext.terrain;
        const modified = restoreOriginalTerrain(site.terrain.originalTerrain, groundType, groundHeight, mapSize);
        if (modified && this.terrainContext.onTerrainModified) {
            this.terrainContext.onTerrainModified('restore', { x: site.tileX, y: site.tileY });
        }
    }
}

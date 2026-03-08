/**
 * ConstructionSiteManager — central registry for active construction sites.
 *
 * Tracks every building currently under construction, from terrain leveling through
 * material delivery and builder progress to completion. Manages digger/builder slot
 * assignments and emits lifecycle events via the EventBus at each phase transition.
 *
 * Follows the Manager pattern: owns state, provides CRUD and query operations.
 * Consumers (digger AI, builder AI, carrier logistics) read from and mutate through
 * this manager rather than touching ConstructionSite objects directly.
 *
 * Terrain fields (terrain.originalTerrain, terrain.modified) are mutated directly on the
 * ConstructionSite record via getSiteOrThrow() — no dedicated accessor methods needed.
 */

import { getBuildingFootprint, type BuildingType } from '../../buildings/types';
import type { Race } from '../../core/race';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionCost } from '../../economy/building-production';
import { getConstructionCosts } from '../../economy/building-production';
import type { EventBus } from '../../event-bus';
import { getBuildingInfo } from '../../data/game-data-access';
import { getBuildingFootprintFromInfo } from '@/resources/game-data';
import type { SeededRng } from '../../core/rng';
import { type ComponentStore, mapStore } from '../../ecs';
import { BuildingConstructionPhase, type CapturedTerrainTile, type ConstructionSite } from './types';
import type { Persistable } from '@/game/persistence';

// ── Serialization types ──

/**
 * Serialized form of a ConstructionSite for game state persistence.
 * Worker assignments (terrain.slots.assigned, building.slots.assigned) are NOT serialized —
 * workers are re-assigned by the settler task system on load.
 */
export interface SerializedConstructionSite {
    buildingId: number;
    buildingType: BuildingType;
    race: Race;
    player: number;
    tileX: number;
    tileY: number;
    phase: BuildingConstructionPhase;
    levelingProgress: number;
    levelingComplete: boolean;
    constructionProgress: number;
    deliveredMaterials: Array<[EMaterialType, number]>;
    consumedAmount: number;
    terrainModified: boolean;
}

// ── Worker count helpers ──

/** Default worker count when XML data is unavailable (e.g. eyecatchers without BuildingInfo). */
const DEFAULT_WORKER_COUNT = 2;

/**
 * Derive worker slot count from building footprint tile count.
 * Thresholds match the design doc (docs/designs/building-construction-process.md).
 */
function getWorkerCountFromFootprint(footprintTileCount: number): number {
    if (footprintTileCount <= 30) return 2;
    if (footprintTileCount <= 60) return 3;
    if (footprintTileCount <= 100) return 4;
    if (footprintTileCount <= 150) return 5;
    return 6;
}

/**
 * Get worker slot count from building footprint size.
 * Falls back to DEFAULT_WORKER_COUNT if no BuildingInfo exists for this building/race.
 */
function getWorkerCount(buildingType: BuildingType, race: Race): number {
    const info = getBuildingInfo(race, buildingType);
    if (!info) return DEFAULT_WORKER_COUNT;
    return getWorkerCountFromFootprint(getBuildingFootprintFromInfo(info).length);
}

// ── ConstructionSiteManager ──

/**
 * Central registry for all buildings currently under construction.
 *
 * Each entry is created by `registerSite` when a building is placed and removed
 * by `removeSite` when construction finishes or is cancelled. Internal methods
 * that require the site to exist throw with context rather than returning silently.
 */
export class ConstructionSiteManager implements Persistable<SerializedConstructionSite[]> {
    readonly persistKey = 'constructionSites' as const;
    private readonly sites = new Map<number, ConstructionSite>();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<ConstructionSite> = mapStore(this.sites);

    private readonly eventBus: EventBus;
    private readonly rng: SeededRng;

    constructor(eventBus: EventBus, rng: SeededRng) {
        this.eventBus = eventBus;
        this.rng = rng;
    }

    // ── Private helpers ──

    /**
     * Look up a site and throw with context if not found.
     * Use for all mutation operations that require the site to exist.
     */
    getSiteOrThrow(buildingId: number, context: string): ConstructionSite {
        const site = this.sites.get(buildingId);
        if (!site) throw new Error(`ConstructionSiteManager[${context}]: no active site for buildingId ${buildingId}`);
        return site;
    }

    // ── Lifecycle ──

    /**
     * Register a new construction site.
     * Derives worker counts from building size and costs from XML game data.
     * Idempotent guard: throws if a site already exists for this buildingId.
     */
    registerSite(
        buildingId: number,
        buildingType: BuildingType,
        race: Race,
        player: number,
        tileX: number,
        tileY: number
    ): void {
        if (this.sites.has(buildingId)) {
            throw new Error(`ConstructionSiteManager: site already registered for buildingId ${buildingId}`);
        }

        const constructionCosts = getConstructionCosts(buildingType, race);
        const totalCost = constructionCosts.reduce((sum, c) => sum + c.count, 0);
        const workerCount = getWorkerCount(buildingType, race);

        const site: ConstructionSite = {
            buildingId,
            buildingType,
            race,
            player,
            tileX,
            tileY,
            phase: BuildingConstructionPhase.WaitingForDiggers,
            terrain: {
                slots: { required: workerCount, assigned: new Set(), started: false },
                progress: 0,
                complete: false,
                originalTerrain: null,
                modified: false,
                unleveledTiles: null,
                reservedTiles: new Set(),
                totalLevelingTiles: 0,
            },
            materials: {
                costs: constructionCosts,
                delivered: new Map(),
                totalCost,
                deliveredAmount: 0,
                consumedAmount: 0,
            },
            building: {
                slots: { required: workerCount, assigned: new Set(), started: false },
                progress: 0,
            },
        };

        this.sites.set(buildingId, site);
        this.eventBus.emit('construction:workerNeeded', { role: 'digger', siteId: buildingId, tileX, tileY, player });
    }

    private emitBuilderNeededIfRequired(site: ConstructionSite): void {
        if (
            site.terrain.complete &&
            site.building.slots.assigned.size < site.building.slots.required &&
            site.materials.deliveredAmount > site.materials.consumedAmount
        ) {
            this.eventBus.emit('construction:workerNeeded', {
                role: 'builder',
                siteId: site.buildingId,
                tileX: site.tileX,
                tileY: site.tileY,
                player: site.player,
            });
        }
    }

    private emitDiggerNeededIfRequired(site: ConstructionSite): void {
        if (!site.terrain.complete && site.terrain.slots.assigned.size < site.terrain.slots.required) {
            this.eventBus.emit('construction:workerNeeded', {
                role: 'digger',
                siteId: site.buildingId,
                tileX: site.tileX,
                tileY: site.tileY,
                player: site.player,
            });
        }
    }

    /** Remove the construction site record. No-op if it doesn't exist. */
    removeSite(buildingId: number): void {
        this.sites.delete(buildingId);
    }

    /** Return the site for `buildingId`, or undefined if not registered. */
    getSite(buildingId: number): ConstructionSite | undefined {
        return this.sites.get(buildingId);
    }

    // ── Queries ──

    /** True when a construction site exists for this building (i.e. not yet operational). */
    hasSite(buildingId: number): boolean {
        return this.sites.has(buildingId);
    }

    /**
     * Get all active site IDs sorted in ascending order for deterministic iteration.
     */
    getAllSiteIds(): number[] {
        return [...this.sites.keys()].sort((a, b) => a - b);
    }

    /** Iterate over all active construction sites. */
    getAllActiveSites(): IterableIterator<ConstructionSite> {
        return this.sites.values();
    }

    // ── Digger management ──

    /** True when there is at least one open digger slot on this site. */
    getDiggerSlotAvailable(buildingId: number): boolean {
        const site = this.getSiteOrThrow(buildingId, 'getDiggerSlotAvailable');
        return site.terrain.slots.assigned.size < site.terrain.slots.required;
    }

    /**
     * Claim a digger slot for `diggerId`.
     * Emits `construction:diggingStarted` when the first digger is assigned.
     */
    claimDiggerSlot(buildingId: number, diggerId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'claimDiggerSlot');
        site.terrain.slots.assigned.add(diggerId);
        this.eventBus.emit('construction:workerAssigned', { buildingId, workerId: diggerId, role: 'digger' });
        if (!site.terrain.slots.started) {
            site.terrain.slots.started = true;
            this.eventBus.emit('construction:diggingStarted', { buildingId });
        }
    }

    /** Release a digger slot previously claimed by `diggerId`. */
    releaseDiggerSlot(buildingId: number, diggerId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'releaseDiggerSlot');
        site.terrain.slots.assigned.delete(diggerId);
        this.eventBus.emit('construction:workerReleased', { buildingId, workerId: diggerId, role: 'digger' });
        this.emitDiggerNeededIfRequired(site);
    }

    /**
     * Populate the per-tile tracking set from captured terrain data.
     * Called once when digging starts and originalTerrain is available.
     * Tiles whose original height already matches targetHeight are skipped.
     */
    populateUnleveledTiles(buildingId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'populateUnleveledTiles');
        if (!site.terrain.originalTerrain) {
            throw new Error(
                `ConstructionSiteManager[populateUnleveledTiles]: no originalTerrain for buildingId ${buildingId}`
            );
        }
        const terrain = site.terrain.originalTerrain;
        const unleveled = new Set<number>();
        for (let i = 0; i < terrain.tiles.length; i++) {
            if (terrain.tiles[i]!.originalGroundHeight !== terrain.targetHeight) {
                unleveled.add(i);
            }
        }
        site.terrain.unleveledTiles = unleveled;
        site.terrain.totalLevelingTiles = unleveled.size;
        // If no tiles need leveling (flat terrain), immediately complete
        if (unleveled.size === 0) {
            site.terrain.complete = true;
            site.terrain.progress = 1;
            this.eventBus.emit('construction:levelingComplete', { buildingId });
            this.emitBuilderNeededIfRequired(site);
        }
    }

    /**
     * Reserve a random unleveled tile for a digger to walk to and dig.
     * Returns the tile index + position, or null if no unreserved tiles remain.
     * The tile stays in unleveledTiles but is excluded from future reservations
     * until released via releaseReservedTile or completed via completeTile.
     */
    reserveUnleveledTile(buildingId: number): { tileIndex: number; x: number; y: number } | null {
        const site = this.getSiteOrThrow(buildingId, 'reserveUnleveledTile');
        if (!site.terrain.unleveledTiles || site.terrain.unleveledTiles.size === 0) return null;

        // Build set of unreserved tiles
        const unreserved: number[] = [];
        for (const idx of site.terrain.unleveledTiles) {
            if (!site.terrain.reservedTiles.has(idx)) unreserved.push(idx);
        }
        if (unreserved.length === 0) return null;

        const tileIndex = unreserved[this.rng.nextInt(unreserved.length)]!;
        site.terrain.reservedTiles.add(tileIndex);
        const tile = site.terrain.originalTerrain!.tiles[tileIndex]!;
        return { tileIndex, x: tile.x, y: tile.y };
    }

    /**
     * Release a previously reserved tile without completing it.
     * Called when a digger is interrupted before finishing the dig animation.
     */
    releaseReservedTile(buildingId: number, tileIndex: number): void {
        const site = this.getSite(buildingId);
        if (site) site.terrain.reservedTiles.delete(tileIndex);
    }

    /**
     * Complete leveling for a specific tile (by index from reserveUnleveledTile).
     * Removes it from unleveledTiles and reservedTiles, emits construction:tileCompleted,
     * updates terrain.progress, and emits construction:levelingComplete when done.
     * Returns the completed tile data, or null if the tile was already completed.
     */
    completeTile(buildingId: number, tileIndex: number): CapturedTerrainTile | null {
        const site = this.getSiteOrThrow(buildingId, 'completeTile');
        if (!site.terrain.unleveledTiles || !site.terrain.unleveledTiles.has(tileIndex)) return null;

        site.terrain.unleveledTiles.delete(tileIndex);
        site.terrain.reservedTiles.delete(tileIndex);

        const tile = site.terrain.originalTerrain!.tiles[tileIndex]!;

        // Emit per-tile event for terrain modification
        this.eventBus.emit('construction:tileCompleted', {
            buildingId,
            tileX: tile.x,
            tileY: tile.y,
            targetHeight: site.terrain.originalTerrain!.targetHeight,
            isFootprint: tile.isFootprint,
        });

        // Update derived progress
        if (site.terrain.totalLevelingTiles > 0) {
            site.terrain.progress = 1 - site.terrain.unleveledTiles.size / site.terrain.totalLevelingTiles;
        }

        // Check completion
        if (site.terrain.unleveledTiles.size === 0) {
            site.terrain.complete = true;
            this.eventBus.emit('construction:levelingComplete', { buildingId });
            this.emitBuilderNeededIfRequired(site);
        }

        return tile;
    }

    // ── Builder management ──

    /** True when there is at least one open builder slot on this site. */
    getBuilderSlotAvailable(buildingId: number): boolean {
        const site = this.getSiteOrThrow(buildingId, 'getBuilderSlotAvailable');
        return site.building.slots.assigned.size < site.building.slots.required;
    }

    /**
     * Claim a builder slot for `builderId`.
     * Emits `construction:buildingStarted` when the first builder is assigned.
     */
    claimBuilderSlot(buildingId: number, builderId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'claimBuilderSlot');
        site.building.slots.assigned.add(builderId);
        this.eventBus.emit('construction:workerAssigned', { buildingId, workerId: builderId, role: 'builder' });
        if (!site.building.slots.started) {
            site.building.slots.started = true;
            this.eventBus.emit('construction:buildingStarted', { buildingId });
        }
    }

    /** Release a builder slot previously claimed by `builderId`. */
    releaseBuilderSlot(buildingId: number, builderId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'releaseBuilderSlot');
        site.building.slots.assigned.delete(builderId);
        this.eventBus.emit('construction:workerReleased', { buildingId, workerId: builderId, role: 'builder' });
        this.emitBuilderNeededIfRequired(site);
    }

    /**
     * Get a random position along the lower border of the building footprint.
     * Builders walk to a random tile on the highest-Y row of the footprint each work cycle.
     */
    getRandomBuilderWorkPos(buildingId: number): { x: number; y: number } {
        const site = this.getSiteOrThrow(buildingId, 'getRandomBuilderWorkPos');
        const footprint = getBuildingFootprint(site.tileX, site.tileY, site.buildingType, site.race);

        // Find the maximum Y (lower border)
        let maxY = -Infinity;
        for (const tile of footprint) {
            if (tile.y > maxY) maxY = tile.y;
        }

        // Collect all tiles on the lower border
        const lowerBorder = footprint.filter(t => t.y === maxY);
        const picked = lowerBorder[this.rng.nextInt(lowerBorder.length)]!;
        return { x: picked.x, y: picked.y };
    }

    /**
     * Advance construction by `amount` (0.0–1.0 fraction).
     * Emits `construction:progressComplete` the first time `building.progress` reaches 1.0.
     */
    advanceConstruction(buildingId: number, amount: number): void {
        const site = this.getSiteOrThrow(buildingId, 'advanceConstruction');
        const wasComplete = site.building.progress >= 1.0;
        site.building.progress += amount;
        if (!wasComplete && site.building.progress >= 1.0) {
            this.eventBus.emit('construction:progressComplete', { buildingId });
        }
    }

    // ── Material tracking ──

    /**
     * Record delivery of `amount` units of `material` to this site.
     * Accumulates into `materials.delivered` and increments `materials.deliveredAmount`.
     */
    recordDelivery(buildingId: number, material: EMaterialType, amount: number): void {
        const site = this.getSiteOrThrow(buildingId, 'recordDelivery');
        const current = site.materials.delivered.get(material) ?? 0;
        site.materials.delivered.set(material, current + amount);
        site.materials.deliveredAmount += amount;
        this.emitBuilderNeededIfRequired(site);
    }

    /**
     * True when there are delivered materials not yet consumed by builders.
     * Builders check this before each work tick.
     */
    hasAvailableMaterials(buildingId: number): boolean {
        const site = this.getSiteOrThrow(buildingId, 'hasAvailableMaterials');
        return site.materials.deliveredAmount > site.materials.consumedAmount;
    }

    /**
     * Returns costs where delivery is still short of the required amount.
     * Each entry reflects the remaining quantity still needed.
     */
    getRemainingCosts(buildingId: number): ConstructionCost[] {
        const site = this.getSiteOrThrow(buildingId, 'getRemainingCosts');
        const remaining: ConstructionCost[] = [];
        for (const cost of site.materials.costs) {
            const delivered = site.materials.delivered.get(cost.material) ?? 0;
            if (delivered < cost.count) {
                remaining.push({ material: cost.material, count: cost.count - delivered });
            }
        }
        return remaining;
    }

    // ── Worker queries ──

    /**
     * Find the nearest site for `player` that still needs a digger.
     * Eligibility: terrain.complete is false AND terrain.slots.assigned.size < terrain.slots.required.
     * Ties broken by buildingId (lower first) for determinism.
     * Returns the buildingId, or undefined if none found.
     */
    findSiteNeedingDiggers(nearX: number, nearY: number, player: number): number | undefined {
        let bestId: number | undefined;
        let bestDist = Infinity;

        for (const site of this.sites.values()) {
            if (site.player !== player) continue;
            if (site.terrain.complete) continue;
            if (site.terrain.slots.assigned.size >= site.terrain.slots.required) continue;

            const dx = site.tileX - nearX;
            const dy = site.tileY - nearY;
            const dist = dx * dx + dy * dy;

            if (dist < bestDist || (dist === bestDist && site.buildingId < bestId!)) {
                bestDist = dist;
                bestId = site.buildingId;
            }
        }

        return bestId;
    }

    /**
     * Find the nearest site for `player` that needs a builder.
     * Eligibility: terrain.complete AND hasAvailableMaterials AND building.slots.assigned.size < building.slots.required.
     * Ties broken by buildingId (lower first) for determinism.
     * Returns the buildingId, or undefined if none found.
     */
    findSiteNeedingBuilders(nearX: number, nearY: number, player: number): number | undefined {
        let bestId: number | undefined;
        let bestDist = Infinity;

        for (const site of this.sites.values()) {
            if (site.player !== player) continue;
            if (!site.terrain.complete) continue;
            if (site.building.slots.assigned.size >= site.building.slots.required) continue;
            if (site.materials.deliveredAmount <= site.materials.consumedAmount) continue;

            const dx = site.tileX - nearX;
            const dy = site.tileY - nearY;
            const dist = dx * dx + dy * dy;

            if (dist < bestDist || (dist === bestDist && site.buildingId < bestId!)) {
                bestDist = dist;
                bestId = site.buildingId;
            }
        }

        return bestId;
    }

    // ── Persistence ──

    /**
     * Serialize all active construction sites for game state persistence.
     * Worker assignments are NOT serialized — workers re-assigned by settler task system on load.
     */
    serializeSites(): SerializedConstructionSite[] {
        const result: SerializedConstructionSite[] = [];
        for (const id of this.getAllSiteIds()) {
            const site = this.sites.get(id);
            if (!site)
                throw new Error(`No construction site for building ${id} in ConstructionSiteManager.serializeSites`);
            result.push({
                buildingId: site.buildingId,
                buildingType: site.buildingType,
                race: site.race,
                player: site.player,
                tileX: site.tileX,
                tileY: site.tileY,
                phase: site.phase,
                levelingProgress: site.terrain.progress,
                levelingComplete: site.terrain.complete,
                constructionProgress: site.building.progress,
                deliveredMaterials: [...site.materials.delivered.entries()],
                consumedAmount: site.materials.consumedAmount,
                terrainModified: site.terrain.modified,
            });
        }
        return result;
    }

    // ── Persistable implementation ──

    serialize(): SerializedConstructionSite[] {
        return this.serializeSites();
    }

    deserialize(data: SerializedConstructionSite[]): void {
        for (const site of data) {
            this.restoreSite(site);
        }
    }

    /**
     * Restore a previously serialized construction site.
     * Worker assignments are left empty — settler task system re-assigns on load.
     * terrain.originalTerrain is not restored — terrain is already in its modified state.
     */
    restoreSite(data: SerializedConstructionSite): void {
        if (this.sites.has(data.buildingId)) {
            throw new Error(
                `ConstructionSiteManager: site already registered for buildingId ${data.buildingId} (during restore)`
            );
        }

        const constructionCosts = getConstructionCosts(data.buildingType, data.race);
        const totalCost = constructionCosts.reduce((sum, c) => sum + c.count, 0);
        const workerCount = getWorkerCount(data.buildingType, data.race);

        const delivered = new Map<EMaterialType, number>(data.deliveredMaterials);
        const deliveredAmount = [...delivered.values()].reduce((sum, v) => sum + v, 0);

        const site: ConstructionSite = {
            buildingId: data.buildingId,
            buildingType: data.buildingType,
            race: data.race,
            player: data.player,
            tileX: data.tileX,
            tileY: data.tileY,
            // Evacuating is a transient sub-frame state — restore as WaitingForBuilders
            phase:
                data.phase === BuildingConstructionPhase.Evacuating
                    ? BuildingConstructionPhase.WaitingForBuilders
                    : data.phase,
            terrain: {
                slots: {
                    required: workerCount,
                    assigned: new Set(),
                    started: data.levelingProgress > 0,
                },
                progress: data.levelingProgress,
                complete: data.levelingComplete,
                // originalTerrain + unleveledTiles are rebuilt from live map data
                // in BuildingConstructionSystem.rebuildTerrainForRestoredSites()
                originalTerrain: null,
                modified: data.terrainModified,
                unleveledTiles: null,
                reservedTiles: new Set(),
                totalLevelingTiles: 0,
            },
            materials: {
                costs: constructionCosts,
                delivered,
                totalCost,
                deliveredAmount,
                consumedAmount: data.consumedAmount,
            },
            building: {
                slots: {
                    required: workerCount,
                    assigned: new Set(),
                    started: data.constructionProgress > 0,
                },
                progress: data.constructionProgress,
            },
        };

        this.sites.set(data.buildingId, site);
    }
}

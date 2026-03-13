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
import type { EventBus } from '../../event-bus';
import type { SeededRng } from '../../core/rng';
import { type ComponentStore, mapStore } from '../../ecs';
import { BuildingConstructionPhase, type CapturedTerrainTile, type ConstructionSite } from './types';
import { PersistentMap } from '@/game/persistence/persistent-store';
import type { TileCoord } from '../../core/coordinates';
import { assignConstructionPilePositions } from '../../systems/inventory/construction-pile-positions';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import { SlotKind } from '../../core/pile-kind';
import {
    type SerializedConstructionSite,
    makeConstructionSiteSerializer,
    getWorkerCount,
    getConstructionCostsAndTotal,
} from './construction-site-serializer';

export type { SerializedConstructionSite };

// ── ConstructionSiteManager ──

/**
 * Central registry for all buildings currently under construction.
 *
 * Each entry is created by `registerSite` when a building is placed and removed
 * by `removeSite` when construction finishes or is cancelled. Internal methods
 * that require the site to exist throw with context rather than returning silently.
 */
export class ConstructionSiteManager {
    readonly persistentStore = new PersistentMap<ConstructionSite>(
        'constructionSites',
        makeConstructionSiteSerializer()
    );

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<ConstructionSite> = mapStore(this.persistentStore.raw);

    private readonly eventBus: EventBus;
    private readonly rng: SeededRng;
    private readonly inventoryManager: BuildingInventoryManager;

    constructor(eventBus: EventBus, rng: SeededRng, inventoryManager: BuildingInventoryManager) {
        this.eventBus = eventBus;
        this.rng = rng;
        this.inventoryManager = inventoryManager;
    }

    // ── Private helpers ──

    /**
     * Look up a site and throw with context if not found.
     * Use for all mutation operations that require the site to exist.
     */
    getSiteOrThrow(buildingId: number, context: string): ConstructionSite {
        const site = this.persistentStore.get(buildingId);
        if (!site) {
            throw new Error(`ConstructionSiteManager[${context}]: no active site for buildingId ${buildingId}`);
        }
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
        if (this.persistentStore.has(buildingId)) {
            throw new Error(`ConstructionSiteManager: site already registered for buildingId ${buildingId}`);
        }

        const { costs: constructionCosts, totalCost } = getConstructionCostsAndTotal(buildingType, race);
        const workerCount = getWorkerCount(buildingType, race);
        const pilePositions = assignConstructionPilePositions(buildingType, race, tileX, tileY);

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
                totalCost,
            },
            building: {
                slots: { required: workerCount, assigned: new Set(), started: false },
                progress: 0,
            },
            pilePositions,
        };

        this.persistentStore.set(buildingId, site);
        this.eventBus.emit('construction:workerNeeded', { role: 'digger', buildingId, x: tileX, y: tileY, player });
    }

    private emitBuilderNeededIfRequired(site: ConstructionSite): void {
        if (
            site.terrain.complete &&
            site.building.slots.assigned.size < site.building.slots.required &&
            this.hasAvailableMaterialsForSite(site)
        ) {
            this.eventBus.emit('construction:workerNeeded', {
                role: 'builder',
                buildingId: site.buildingId,
                x: site.tileX,
                y: site.tileY,
                player: site.player,
            });
        }
    }

    /**
     * Query inventory directly: true when any input slot for this site has material available to consume.
     */
    private hasAvailableMaterialsForSite(site: ConstructionSite): boolean {
        return this.inventoryManager
            .getSlots(site.buildingId)
            .some(s => s.kind === SlotKind.Input && s.currentAmount > 0);
    }

    private emitDiggerNeededIfRequired(site: ConstructionSite): void {
        if (!site.terrain.complete && site.terrain.slots.assigned.size < site.terrain.slots.required) {
            this.eventBus.emit('construction:workerNeeded', {
                role: 'digger',
                buildingId: site.buildingId,
                x: site.tileX,
                y: site.tileY,
                player: site.player,
            });
        }
    }

    /** Remove the construction site record. No-op if it doesn't exist. */
    removeSite(buildingId: number): void {
        this.persistentStore.delete(buildingId);
    }

    /** Return the site for `buildingId`, or undefined if not registered. */
    getSite(buildingId: number): ConstructionSite | undefined {
        return this.persistentStore.get(buildingId);
    }

    // ── Queries ──

    /** True when a construction site exists for this building (i.e. not yet operational). */
    hasSite(buildingId: number): boolean {
        return this.persistentStore.has(buildingId);
    }

    /**
     * Get all active site IDs sorted in ascending order for deterministic iteration.
     */
    getAllSiteIds(): number[] {
        return [...this.persistentStore.keys()].sort((a, b) => a - b);
    }

    /** Iterate over all active construction sites. */
    getAllActiveSites(): IterableIterator<ConstructionSite> {
        return this.persistentStore.values();
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
        this.eventBus.emit('construction:workerAssigned', { buildingId, unitId: diggerId, role: 'digger' });
        if (!site.terrain.slots.started) {
            site.terrain.slots.started = true;
            this.eventBus.emit('construction:diggingStarted', { buildingId });
        }
    }

    /** Release a digger slot previously claimed by `diggerId`. */
    releaseDiggerSlot(buildingId: number, diggerId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'releaseDiggerSlot');
        site.terrain.slots.assigned.delete(diggerId);
        this.eventBus.emit('construction:workerReleased', { buildingId, unitId: diggerId, role: 'digger' });
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
        if (!site.terrain.unleveledTiles || site.terrain.unleveledTiles.size === 0) {
            return null;
        }

        // Build set of unreserved tiles
        const unreserved: number[] = [];
        for (const idx of site.terrain.unleveledTiles) {
            if (!site.terrain.reservedTiles.has(idx)) {
                unreserved.push(idx);
            }
        }
        if (unreserved.length === 0) {
            return null;
        }

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
        if (site) {
            site.terrain.reservedTiles.delete(tileIndex);
        }
    }

    /**
     * Complete leveling for a specific tile (by index from reserveUnleveledTile).
     * Removes it from unleveledTiles and reservedTiles, emits construction:tileCompleted,
     * updates terrain.progress, and emits construction:levelingComplete when done.
     * Returns the completed tile data, or null if the tile was already completed.
     */
    completeTile(buildingId: number, tileIndex: number): CapturedTerrainTile | null {
        const site = this.getSiteOrThrow(buildingId, 'completeTile');
        if (!site.terrain.unleveledTiles || !site.terrain.unleveledTiles.has(tileIndex)) {
            return null;
        }

        site.terrain.unleveledTiles.delete(tileIndex);
        site.terrain.reservedTiles.delete(tileIndex);

        const tile = site.terrain.originalTerrain!.tiles[tileIndex]!;

        // Emit per-tile event for terrain modification
        this.eventBus.emit('construction:tileCompleted', {
            buildingId,
            x: tile.x,
            y: tile.y,
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
        this.eventBus.emit('construction:workerAssigned', { buildingId, unitId: builderId, role: 'builder' });
        if (!site.building.slots.started) {
            site.building.slots.started = true;
            this.eventBus.emit('construction:buildingStarted', { buildingId });
        }
    }

    /** Release a builder slot previously claimed by `builderId`. */
    releaseBuilderSlot(buildingId: number, builderId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'releaseBuilderSlot');
        site.building.slots.assigned.delete(builderId);
        this.eventBus.emit('construction:workerReleased', { buildingId, unitId: builderId, role: 'builder' });
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
            if (tile.y > maxY) {
                maxY = tile.y;
            }
        }

        // Collect all tiles on the lower border
        const lowerBorder = footprint.filter(t => t.y === maxY);
        const picked = lowerBorder[this.rng.nextInt(lowerBorder.length)]!;
        return { x: picked.x, y: picked.y };
    }

    /**
     * Set construction progress to an absolute value (0.0–1.0).
     * Emits `construction:progressComplete` the first time progress reaches 1.0.
     */
    setConstructionProgress(buildingId: number, progress: number): void {
        const site = this.getSiteOrThrow(buildingId, 'setConstructionProgress');
        const wasComplete = site.building.progress >= 1.0;
        site.building.progress = progress;
        if (!wasComplete && site.building.progress >= 1.0) {
            this.eventBus.emit('construction:progressComplete', { buildingId });
        }
    }

    // ── Material tracking ──

    /**
     * True when any input slot in the building's inventory has material for builders to consume.
     * Queries inventory directly — no shadow delivered/consumed tracking.
     */
    hasAvailableMaterials(buildingId: number): boolean {
        const site = this.getSiteOrThrow(buildingId, 'hasAvailableMaterials');
        return this.hasAvailableMaterialsForSite(site);
    }

    /**
     * Pick the next material to consume.
     * Iterates costs in order, finding the first material where throughput.totalOut is
     * below the required cost and an input slot has inventory available.
     * Returns the material type, or null if none available.
     */
    consumeNextMaterial(buildingId: number): EMaterialType | null {
        const site = this.persistentStore.get(buildingId);
        if (!site) {
            return null;
        }
        const slots = this.inventoryManager.getSlots(buildingId);

        for (const cost of site.materials.costs) {
            const throughput = this.inventoryManager.getThroughput(buildingId, cost.material);
            if (throughput.totalOut >= cost.count) {
                continue;
            }
            const inSlots = slots
                .filter(s => s.kind === SlotKind.Input && s.materialType === cost.material)
                .reduce((sum, s) => sum + s.currentAmount, 0);
            if (inSlots > 0) {
                return cost.material;
            }
        }
        return null;
    }

    /**
     * Returns costs where remaining delivery is still short of the required amount.
     * Remaining = cost.count - throughput.totalIn per material.
     * totalIn = cumulative units deposited (delivered), so remaining = what still needs delivery.
     */
    getRemainingCosts(buildingId: number): ConstructionCost[] {
        const site = this.getSiteOrThrow(buildingId, 'getRemainingCosts');
        const remaining: ConstructionCost[] = [];

        for (const cost of site.materials.costs) {
            const throughput = this.inventoryManager.getThroughput(buildingId, cost.material);
            if (throughput.totalIn < cost.count) {
                remaining.push({ material: cost.material, count: cost.count - throughput.totalIn });
            }
        }
        return remaining;
    }

    // ── Pile positions ──

    /**
     * Get the pre-computed pile position for a material at a specific pile index.
     * Returns undefined if the site/material/index doesn't exist.
     */
    getConstructionPilePosition(
        buildingId: number,
        material: EMaterialType,
        pileIndex: number = 0
    ): TileCoord | undefined {
        return this.persistentStore.get(buildingId)?.pilePositions.get(material)?.[pileIndex];
    }

    /**
     * Get all pre-computed pile positions for a material at a construction site.
     * Returns undefined if the site doesn't exist or has no positions for that material.
     */
    getConstructionPilePositions(buildingId: number, material: EMaterialType): readonly TileCoord[] | undefined {
        return this.persistentStore.get(buildingId)?.pilePositions.get(material);
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

        for (const site of this.persistentStore.values()) {
            if (site.player !== player) {
                continue;
            }
            if (site.terrain.complete) {
                continue;
            }
            if (site.terrain.slots.assigned.size >= site.terrain.slots.required) {
                continue;
            }

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

        for (const site of this.persistentStore.values()) {
            if (site.player !== player) {
                continue;
            }
            if (!site.terrain.complete) {
                continue;
            }
            if (site.building.slots.assigned.size >= site.building.slots.required) {
                continue;
            }
            if (!this.hasAvailableMaterialsForSite(site)) {
                continue;
            }

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
}

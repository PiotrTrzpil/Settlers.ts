/**
 * ConstructionSiteManager — central registry for active construction sites.
 *
 * Tracks every building currently under construction, from terrain leveling through
 * material delivery and builder progress to completion. Owns physical site state only
 * (terrain leveling, materials, build progress, pile layout, phase) and emits lifecycle
 * events via the EventBus at each phase transition.
 *
 * Which worker is on which site (and which tile each digger holds) is owned by
 * ConstructionSiteDemandSystem. The manager notifies it of demand-relevant transitions
 * through a single injected ConstructionSiteListener.
 *
 * Follows the Manager pattern: owns state, provides CRUD and query operations.
 * Consumers (digger AI, builder AI, carrier logistics) read from and mutate through
 * this manager rather than touching ConstructionSite objects directly.
 *
 * Terrain fields (terrain.originalTerrain, terrain.modified) are mutated directly on the
 * ConstructionSite record via getSiteOrThrow() — no dedicated accessor methods needed.
 */

import { getBuildingFootprint, isMineBuilding, type BuildingType } from '../../buildings/types';
import type { Race } from '../../core/race';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionCost } from '../../economy/building-production';
import type { EventBus } from '../../event-bus';
import type { SeededRng } from '../../core/rng';
import { type ComponentStore, mapStore } from '../../ecs';
import { BuildingConstructionPhase, type CapturedTerrainTile, type ConstructionSite } from './types';
import { PersistentMap } from '@/game/persistence/persistent-store';
import type { Tile } from '../../core/coordinates';
import { assignConstructionPilePositions } from '../../systems/inventory/construction-pile-positions';

export type IndexedTile = Tile & { tileIndex: number };
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import { SlotKind } from '../../core/pile-kind';
import {
    type SerializedConstructionSite,
    makeConstructionSiteSerializer,
    getWorkerCount,
    getConstructionCostsAndTotal,
} from './construction-site-serializer';

export type { SerializedConstructionSite };

/**
 * Receives the site transitions that change construction worker demand.
 * Implemented by ConstructionSiteDemandSystem and registered via `setListener`.
 */
export interface ConstructionSiteListener {
    /** A new site was registered (diggers needed, or builders for mines that skip leveling). */
    onSiteRegistered(buildingId: number): void;
    /** Terrain leveling finished — diggers are done, builders are needed. */
    onLevelingComplete(buildingId: number): void;
}

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
    private listener: ConstructionSiteListener | null = null;

    constructor(eventBus: EventBus, rng: SeededRng, inventoryManager: BuildingInventoryManager) {
        this.eventBus = eventBus;
        this.rng = rng;
        this.inventoryManager = inventoryManager;
    }

    /**
     * Register the worker-demand listener. Called once by the construction-demand feature,
     * which is created after this manager because it depends on settler-tasks + recruit.
     */
    setListener(listener: ConstructionSiteListener): void {
        if (this.listener) {
            throw new Error('ConstructionSiteManager.setListener: listener already registered');
        }
        this.listener = listener;
    }

    private getListener(context: string): ConstructionSiteListener {
        if (!this.listener) {
            throw new Error(`ConstructionSiteManager[${context}]: no ConstructionSiteListener registered`);
        }
        return this.listener;
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

        const isMine = isMineBuilding(buildingType);

        const site: ConstructionSite = {
            buildingId,
            buildingType,
            race,
            player,
            tileX,
            tileY,
            phase: isMine ? BuildingConstructionPhase.WaitingForBuilders : BuildingConstructionPhase.WaitingForDiggers,
            terrain: {
                slots: { required: workerCount, started: false },
                progress: isMine ? 1 : 0,
                complete: isMine,
                originalTerrain: null,
                modified: isMine,
                unleveledTiles: null,
                totalLevelingTiles: 0,
            },
            materials: {
                costs: constructionCosts,
                totalCost,
            },
            building: {
                slots: { required: workerCount, started: false },
                progress: 0,
            },
            pilePositions,
        };

        this.persistentStore.set(buildingId, site);

        if (isMine) {
            // Mines skip terrain leveling entirely — apply footprint blocking immediately via the
            // existing levelingComplete handler; the listener then requests builders instead of diggers.
            this.eventBus.emit('construction:levelingComplete', { buildingId });
        }
        this.getListener('registerSite').onSiteRegistered(buildingId);
    }

    /** Mark terrain leveling complete: emit the domain event, then notify the demand listener. */
    private finishLeveling(site: ConstructionSite): void {
        site.terrain.complete = true;
        this.eventBus.emit('construction:levelingComplete', { buildingId: site.buildingId });
        this.getListener('finishLeveling').onLevelingComplete(site.buildingId);
    }

    /**
     * Query inventory directly: true when any input slot for this site has material available to consume.
     */
    private hasAvailableMaterialsForSite(site: ConstructionSite): boolean {
        return this.inventoryManager
            .getSlots(site.buildingId)
            .some(s => s.kind === SlotKind.Input && s.currentAmount > 0);
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

    // ── Phase start ──

    /**
     * Record that a digger was committed to this site.
     * Emits `construction:diggingStarted` the first time.
     */
    markDiggingStarted(buildingId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'markDiggingStarted');
        if (!site.terrain.slots.started) {
            site.terrain.slots.started = true;
            this.eventBus.emit('construction:diggingStarted', { buildingId });
        }
    }

    /**
     * Record that a builder was committed to this site.
     * Emits `construction:buildingStarted` the first time.
     */
    markBuildingStarted(buildingId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'markBuildingStarted');
        if (!site.building.slots.started) {
            site.building.slots.started = true;
            this.eventBus.emit('construction:buildingStarted', { buildingId });
        }
    }

    // ── Terrain leveling ──

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
            site.terrain.progress = 1;
            this.finishLeveling(site);
        }
    }

    /**
     * Pick an unleveled tile for a digger to walk to and dig, skipping `reserved` tiles
     * (those already held by other diggers — the caller owns that reservation set).
     * Prefers tiles with the largest height deviation from the target —
     * leveling the most extreme tiles first produces visually smooth
     * progressive flattening instead of random patchwork.
     *
     * Among tiles with similar deviation (within 2 units), a random one
     * is picked so multiple diggers don't all cluster on the same spot.
     */
    pickUnleveledTile(buildingId: number, reserved: ReadonlySet<number>): IndexedTile | null {
        const site = this.getSiteOrThrow(buildingId, 'pickUnleveledTile');
        if (!site.terrain.unleveledTiles || site.terrain.unleveledTiles.size === 0) {
            return null;
        }

        const terrain = site.terrain.originalTerrain!;
        const targetH = terrain.targetHeight;

        // Collect unreserved tiles with their height deviation from target
        let maxDev = 0;
        const unreserved: Array<{ idx: number; dev: number }> = [];
        for (const idx of site.terrain.unleveledTiles) {
            if (reserved.has(idx)) {
                continue;
            }
            const dev = Math.abs(terrain.tiles[idx]!.originalGroundHeight - targetH);
            unreserved.push({ idx, dev });
            if (dev > maxDev) {
                maxDev = dev;
            }
        }
        if (unreserved.length === 0) {
            return null;
        }

        // Pick randomly from tiles near the worst deviation (within 2 height units)
        const threshold = Math.max(maxDev - 2, 0);
        const candidates = unreserved.filter(t => t.dev >= threshold);
        const chosen = candidates[this.rng.nextInt(candidates.length)]!;

        const tile = terrain.tiles[chosen.idx]!;
        return { tileIndex: chosen.idx, x: tile.x, y: tile.y };
    }

    /**
     * Complete leveling for a specific tile (by index from pickUnleveledTile).
     * Removes it from unleveledTiles, emits construction:tileCompleted,
     * updates terrain.progress, and emits construction:levelingComplete when done.
     * Returns the completed tile data, or null if the tile was already completed.
     */
    completeTile(buildingId: number, tileIndex: number): CapturedTerrainTile | null {
        const site = this.getSiteOrThrow(buildingId, 'completeTile');
        if (!site.terrain.unleveledTiles || !site.terrain.unleveledTiles.has(tileIndex)) {
            return null;
        }

        site.terrain.unleveledTiles.delete(tileIndex);

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
            this.finishLeveling(site);
        }

        return tile;
    }

    // ── Builder work ──

    /**
     * Get a random position along the lower border of the building footprint.
     * Builders walk to a random tile on the highest-Y row of the footprint each work cycle.
     */
    getRandomBuilderWorkPos(buildingId: number): Tile {
        const site = this.getSiteOrThrow(buildingId, 'getRandomBuilderWorkPos');
        const footprint = getBuildingFootprint({ x: site.tileX, y: site.tileY }, site.buildingType, site.race);

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
    getConstructionPilePosition(buildingId: number, material: EMaterialType, pileIndex: number = 0): Tile | undefined {
        return this.persistentStore.get(buildingId)?.pilePositions.get(material)?.[pileIndex];
    }

    /**
     * Get all pre-computed pile positions for a material at a construction site.
     * Returns undefined if the site doesn't exist or has no positions for that material.
     */
    getConstructionPilePositions(buildingId: number, material: EMaterialType): readonly Tile[] | undefined {
        return this.persistentStore.get(buildingId)?.pilePositions.get(material);
    }
}

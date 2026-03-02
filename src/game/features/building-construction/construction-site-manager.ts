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
 * Terrain fields (originalTerrain, terrainModified) are mutated directly on the
 * ConstructionSite record via getSiteOrThrow() — no dedicated accessor methods needed.
 */

import type { BuildingType } from '../../buildings/types';
import { getBuildingSize } from '../../buildings/types';
import type { Race } from '../../race';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionCost } from '../../economy/building-production';
import { getConstructionCosts } from '../../economy/building-production';
import type { EventBus } from '../../event-bus';
import { BuildingConstructionPhase, type ConstructionSite } from './types';

// ── Serialization types ──

/**
 * Serialized form of a ConstructionSite for game state persistence.
 * Worker assignments (assignedDiggers, assignedBuilders) are NOT serialized —
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

/**
 * Derive worker slot count from building footprint area.
 * 2×2 (area ≤ 4) → 2 workers; 3×3 (area = 9) → 3 workers.
 */
function getWorkerCount(buildingType: BuildingType): number {
    const size = getBuildingSize(buildingType);
    const area = size.width * size.height;
    return area <= 4 ? 2 : 3;
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
    private readonly sites = new Map<number, ConstructionSite>();
    private readonly eventBus: EventBus;

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
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
        const totalCostAmount = constructionCosts.reduce((sum, c) => sum + c.count, 0);
        const workerCount = getWorkerCount(buildingType);

        const site: ConstructionSite = {
            buildingId,
            buildingType,
            race,
            player,
            tileX,
            tileY,
            phase: BuildingConstructionPhase.WaitingForDiggers,
            originalTerrain: null,
            terrainModified: false,
            requiredDiggers: workerCount,
            assignedDiggers: new Set(),
            levelingProgress: 0,
            levelingComplete: false,
            constructionCosts,
            deliveredMaterials: new Map(),
            totalCostAmount,
            deliveredAmount: 0,
            requiredBuilders: workerCount,
            assignedBuilders: new Set(),
            constructionProgress: 0,
            consumedAmount: 0,
            completedRisingProgress: 0,
        };

        this.sites.set(buildingId, site);
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
        return site.assignedDiggers.size < site.requiredDiggers;
    }

    /**
     * Claim a digger slot for `diggerId`.
     * Emits `construction:diggingStarted` when the first digger is assigned.
     */
    claimDiggerSlot(buildingId: number, diggerId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'claimDiggerSlot');
        const wasEmpty = site.assignedDiggers.size === 0;
        site.assignedDiggers.add(diggerId);
        if (wasEmpty) {
            this.eventBus.emit('construction:diggingStarted', { buildingId });
        }
    }

    /** Release a digger slot previously claimed by `diggerId`. */
    releaseDiggerSlot(buildingId: number, diggerId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'releaseDiggerSlot');
        site.assignedDiggers.delete(diggerId);
    }

    /**
     * Advance terrain leveling by `amount` (0.0–1.0 fraction).
     * Emits `construction:levelingComplete` the first time `levelingProgress` reaches 1.0.
     */
    advanceLeveling(buildingId: number, amount: number): void {
        const site = this.getSiteOrThrow(buildingId, 'advanceLeveling');
        if (site.levelingComplete) return;
        site.levelingProgress += amount;
        if (site.levelingProgress >= 1.0) {
            site.levelingComplete = true;
            this.eventBus.emit('construction:levelingComplete', { buildingId });
        }
    }

    // ── Builder management ──

    /** True when there is at least one open builder slot on this site. */
    getBuilderSlotAvailable(buildingId: number): boolean {
        const site = this.getSiteOrThrow(buildingId, 'getBuilderSlotAvailable');
        return site.assignedBuilders.size < site.requiredBuilders;
    }

    /**
     * Claim a builder slot for `builderId`.
     * Emits `construction:buildingStarted` when the first builder is assigned.
     */
    claimBuilderSlot(buildingId: number, builderId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'claimBuilderSlot');
        const wasEmpty = site.assignedBuilders.size === 0;
        site.assignedBuilders.add(builderId);
        if (wasEmpty) {
            this.eventBus.emit('construction:buildingStarted', { buildingId });
        }
    }

    /** Release a builder slot previously claimed by `builderId`. */
    releaseBuilderSlot(buildingId: number, builderId: number): void {
        const site = this.getSiteOrThrow(buildingId, 'releaseBuilderSlot');
        site.assignedBuilders.delete(builderId);
    }

    /**
     * Advance construction by `amount` (0.0–1.0 fraction).
     * Emits `construction:progressComplete` the first time `constructionProgress` reaches 1.0.
     */
    advanceConstruction(buildingId: number, amount: number): void {
        const site = this.getSiteOrThrow(buildingId, 'advanceConstruction');
        const wasComplete = site.constructionProgress >= 1.0;
        site.constructionProgress += amount;
        if (!wasComplete && site.constructionProgress >= 1.0) {
            this.eventBus.emit('construction:progressComplete', { buildingId });
        }
    }

    // ── Material tracking ──

    /**
     * Record delivery of `amount` units of `material` to this site.
     * Accumulates into `deliveredMaterials` and increments `deliveredAmount`.
     */
    recordDelivery(buildingId: number, material: EMaterialType, amount: number): void {
        const site = this.getSiteOrThrow(buildingId, 'recordDelivery');
        const current = site.deliveredMaterials.get(material) ?? 0;
        site.deliveredMaterials.set(material, current + amount);
        site.deliveredAmount += amount;
    }

    /**
     * True when there are delivered materials not yet consumed by builders.
     * Builders check this before each work tick.
     */
    hasAvailableMaterials(buildingId: number): boolean {
        const site = this.getSiteOrThrow(buildingId, 'hasAvailableMaterials');
        return site.deliveredAmount > site.consumedAmount;
    }

    /**
     * Returns costs where delivery is still short of the required amount.
     * Each entry reflects the remaining quantity still needed.
     */
    getRemainingCosts(buildingId: number): ConstructionCost[] {
        const site = this.getSiteOrThrow(buildingId, 'getRemainingCosts');
        const remaining: ConstructionCost[] = [];
        for (const cost of site.constructionCosts) {
            const delivered = site.deliveredMaterials.get(cost.material) ?? 0;
            if (delivered < cost.count) {
                remaining.push({ material: cost.material, count: cost.count - delivered });
            }
        }
        return remaining;
    }

    // ── Worker queries ──

    /**
     * Find the nearest site for `player` that still needs a digger.
     * Eligibility: leveling not complete AND assignedDiggers.size < requiredDiggers.
     * Ties broken by buildingId (lower first) for determinism.
     * Returns the buildingId, or undefined if none found.
     */
    findSiteNeedingDiggers(nearX: number, nearY: number, player: number): number | undefined {
        let bestId: number | undefined;
        let bestDist = Infinity;

        for (const site of this.sites.values()) {
            if (site.player !== player) continue;
            if (site.levelingComplete) continue;
            if (site.assignedDiggers.size >= site.requiredDiggers) continue;

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
     * Eligibility: levelingComplete AND hasAvailableMaterials AND assignedBuilders.size < requiredBuilders.
     * Ties broken by buildingId (lower first) for determinism.
     * Returns the buildingId, or undefined if none found.
     */
    findSiteNeedingBuilders(nearX: number, nearY: number, player: number): number | undefined {
        let bestId: number | undefined;
        let bestDist = Infinity;

        for (const site of this.sites.values()) {
            if (site.player !== player) continue;
            if (!site.levelingComplete) continue;
            if (site.assignedBuilders.size >= site.requiredBuilders) continue;
            if (site.deliveredAmount <= site.consumedAmount) continue;

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
            const site = this.sites.get(id)!;
            result.push({
                buildingId: site.buildingId,
                buildingType: site.buildingType,
                race: site.race,
                player: site.player,
                tileX: site.tileX,
                tileY: site.tileY,
                phase: site.phase,
                levelingProgress: site.levelingProgress,
                levelingComplete: site.levelingComplete,
                constructionProgress: site.constructionProgress,
                deliveredMaterials: [...site.deliveredMaterials.entries()],
                consumedAmount: site.consumedAmount,
                terrainModified: site.terrainModified,
            });
        }
        return result;
    }

    /**
     * Restore a previously serialized construction site.
     * Worker assignments are left empty — settler task system re-assigns on load.
     * originalTerrain is not restored — terrain is already in its modified state.
     */
    restoreSite(data: SerializedConstructionSite): void {
        if (this.sites.has(data.buildingId)) {
            throw new Error(
                `ConstructionSiteManager: site already registered for buildingId ${data.buildingId} (during restore)`
            );
        }

        const constructionCosts = getConstructionCosts(data.buildingType, data.race);
        const totalCostAmount = constructionCosts.reduce((sum, c) => sum + c.count, 0);
        const workerCount = getWorkerCount(data.buildingType);

        const deliveredMaterials = new Map<EMaterialType, number>(data.deliveredMaterials);
        const deliveredAmount = [...deliveredMaterials.values()].reduce((sum, v) => sum + v, 0);

        const site: ConstructionSite = {
            buildingId: data.buildingId,
            buildingType: data.buildingType,
            race: data.race,
            player: data.player,
            tileX: data.tileX,
            tileY: data.tileY,
            phase: data.phase,
            originalTerrain: null, // Not persisted — terrain is already in modified state
            terrainModified: data.terrainModified,
            requiredDiggers: workerCount,
            assignedDiggers: new Set(),
            levelingProgress: data.levelingProgress,
            levelingComplete: data.levelingComplete,
            constructionCosts,
            deliveredMaterials,
            totalCostAmount,
            deliveredAmount,
            requiredBuilders: workerCount,
            assignedBuilders: new Set(),
            constructionProgress: data.constructionProgress,
            consumedAmount: data.consumedAmount,
            completedRisingProgress: 0,
        };

        this.sites.set(data.buildingId, site);
    }
}

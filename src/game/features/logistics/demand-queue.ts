/**
 * DemandQueue — stateless prioritized demand queue.
 *
 * Replaces RequestManager. No lifecycle state, no carrier assignment, no source tracking.
 * Demands are added by scanners, consumed by the dispatcher, and automatically
 * re-created if the underlying need persists.
 *
 * NOT persisted — on game load, demand scanners run on first tick and recompute
 * all demands from inventory state + job store.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { EventBus } from '../../event-bus';

/**
 * Priority levels for material demands.
 * Lower numeric value = higher priority.
 */
export enum DemandPriority {
    /** Urgent demands (military, critical) */
    High = 0,
    /** Standard production/construction demands */
    Normal = 1,
    /** Low priority (stockpiling, storage imports) */
    Low = 2,
}

/** A demand for material delivery. No lifecycle state — just "building X needs material Y". */
export interface DemandEntry {
    readonly id: number;
    readonly buildingId: number;
    readonly materialType: EMaterialType;
    readonly amount: number;
    readonly priority: DemandPriority;
    /** Game time when demand was created (seconds, for deterministic ordering). */
    readonly timestamp: number;
}

/**
 * Prioritized demand queue. No status tracking, no carrier assignment.
 *
 * Demands are added by scanners, consumed by the dispatcher, and
 * automatically re-created if the underlying need persists.
 */
export class DemandQueue {
    private readonly demands = new Map<number, DemandEntry>();

    /** Secondary index: buildingId → set of demand IDs. */
    private readonly byBuilding = new Map<number, Set<number>>();

    /** Cached sorted demands list. */
    private sortedCache: readonly DemandEntry[] = [];
    private sortedCacheDirty = true;

    /** Next demand ID. */
    private nextId = 1;

    /** Accumulated game time in seconds. */
    private gameTime = 0;

    private readonly eventBus: EventBus | null;

    constructor(eventBus?: EventBus) {
        this.eventBus = eventBus ?? null;
    }

    /**
     * Advance the internal game clock. Call once per tick with the game delta time.
     */
    advanceTime(dt: number): void {
        this.gameTime += dt;
    }

    /** Get the current accumulated game time in seconds. */
    getGameTime(): number {
        return this.gameTime;
    }

    /**
     * Add a demand. Returns the created entry.
     */
    addDemand(buildingId: number, material: EMaterialType, amount: number, priority: DemandPriority): DemandEntry {
        const entry: DemandEntry = {
            id: this.nextId++,
            buildingId,
            materialType: material,
            amount: Math.max(1, Math.floor(amount)),
            priority,
            timestamp: this.gameTime,
        };

        this.demands.set(entry.id, entry);
        this.addToBuildingIndex(entry.buildingId, entry.id);
        this.sortedCacheDirty = true;

        this.eventBus?.emit('logistics:demandCreated', {
            demandId: entry.id,
            buildingId: entry.buildingId,
            materialType: entry.materialType,
            amount: entry.amount,
            priority: entry.priority,
        });

        return entry;
    }

    /**
     * Get all demands sorted by priority then timestamp. Cached, rebuilt on mutation.
     */
    getSortedDemands(): readonly DemandEntry[] {
        if (this.sortedCacheDirty) {
            const sorted = [...this.demands.values()];
            sorted.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return a.timestamp - b.timestamp;
            });
            this.sortedCache = sorted;
            this.sortedCacheDirty = false;
        }
        return this.sortedCache;
    }

    /**
     * Remove a single demand by ID (consumed by dispatcher when job is created).
     */
    consumeDemand(demandId: number): boolean {
        const entry = this.demands.get(demandId);
        if (!entry) return false;

        this.demands.delete(demandId);
        this.removeFromBuildingIndex(entry.buildingId, demandId);
        this.sortedCacheDirty = true;

        this.eventBus?.emit('logistics:demandConsumed', {
            demandId: entry.id,
            buildingId: entry.buildingId,
            materialType: entry.materialType,
        });

        return true;
    }

    /**
     * Remove all demands for a building (building destroyed).
     */
    cancelDemandsForBuilding(buildingId: number): number {
        const demandIds = this.byBuilding.get(buildingId);
        if (!demandIds || demandIds.size === 0) return 0;

        const ids = [...demandIds].sort((a, b) => a - b); // deterministic order
        for (const id of ids) {
            this.demands.delete(id);
        }
        this.byBuilding.delete(buildingId);
        this.sortedCacheDirty = true;
        return ids.length;
    }

    /**
     * Count active demands for a building+material. Used by scanners to avoid over-requesting.
     */
    countDemands(buildingId: number, material: EMaterialType): number {
        const demandIds = this.byBuilding.get(buildingId);
        if (!demandIds) return 0;

        let count = 0;
        for (const id of demandIds) {
            const entry = this.demands.get(id)!;
            if (entry.materialType === material) count++;
        }
        return count;
    }

    /** Get a demand by ID. */
    getDemand(demandId: number): DemandEntry | undefined {
        return this.demands.get(demandId);
    }

    /** Get all demands (for diagnostics). */
    getAllDemands(): IterableIterator<DemandEntry> {
        return this.demands.values();
    }

    /** Total demand count. */
    get size(): number {
        return this.demands.size;
    }

    /** Clear all demands. */
    clear(): void {
        this.demands.clear();
        this.byBuilding.clear();
        this.sortedCacheDirty = true;
        this.nextId = 1;
        this.gameTime = 0;
    }

    // ── Internal helpers ──

    private addToBuildingIndex(buildingId: number, demandId: number): void {
        let set = this.byBuilding.get(buildingId);
        if (!set) {
            set = new Set();
            this.byBuilding.set(buildingId, set);
        }
        set.add(demandId);
    }

    private removeFromBuildingIndex(buildingId: number, demandId: number): void {
        const set = this.byBuilding.get(buildingId);
        if (!set) return;
        set.delete(demandId);
        if (set.size === 0) {
            this.byBuilding.delete(buildingId);
        }
    }
}
